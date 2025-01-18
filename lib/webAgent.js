// lib/webAgent.js
import chromium from 'chrome-aws-lambda';
import { Configuration, OpenAIApi } from 'openai';

export class WebAgent {
    constructor(apiKey) {
        this.configuration = new Configuration({
            apiKey: apiKey
        });
        this.openai = new OpenAIApi(this.configuration);
        this.browser = null;
        this.page = null;
    }

    async initialize() {
        // Use chrome-aws-lambda for Vercel compatibility
        this.browser = await chromium.puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath,
            headless: true,
        });
        this.page = await this.browser.newPage();
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async executeTask(url, task) {
        try {
            // Navigate to the URL
            await this.page.goto(url, { 
                waitUntil: 'networkidle0',
                timeout: 8000 // Vercel has 10s limit, so we set this lower
            });

            // Extract page content
            const content = await this.extractPageContent();

            // Analyze content and determine actions
            const analysis = await this.analyzeContent(content, task);

            // Execute determined actions
            const result = await this.executeActions(analysis);

            return {
                success: true,
                result,
                message: 'Task completed successfully'
            };

        } catch (error) {
            throw new Error(`Task execution failed: ${error.message}`);
        }
    }

    async extractPageContent() {
        return await this.page.evaluate(() => {
            return {
                text: document.body.innerText,
                links: Array.from(document.getElementsByTagName('a')).map(a => ({
                    text: a.innerText,
                    href: a.href
                })),
                inputs: Array.from(document.getElementsByTagName('input')).map(input => ({
                    type: input.type,
                    id: input.id,
                    name: input.name,
                    placeholder: input.placeholder
                })),
                buttons: Array.from(document.getElementsByTagName('button')).map(button => ({
                    text: button.innerText,
                    id: button.id,
                    type: button.type
                }))
            };
        });
    }

    async analyzeContent(content, task) {
        const prompt = `
        Analyze this webpage and determine how to complete the following task:
        "${task}"

        Page Content:
        ${content.text.slice(0, 1000)}... // Truncated for token limit

        Available Elements:
        Links: ${JSON.stringify(content.links)}
        Inputs: ${JSON.stringify(content.inputs)}
        Buttons: ${JSON.stringify(content.buttons)}

        Provide a list of specific actions needed to complete the task.
        Each action should include:
        1. Action type (click, type, submit)
        2. Target element
        3. Any required values
        4. Order of execution
        `;

        const completion = await this.openai.createChatCompletion({
            model: "gpt-4",
            messages: [
                { 
                    role: "system", 
                    content: "You are a web automation expert. Analyze the page and provide specific, actionable steps to complete the task."
                },
                { 
                    role: "user", 
                    content: prompt 
                }
            ],
            temperature: 0.7,
        });

        return this.parseAnalysis(completion.data.choices[0].message.content);
    }

    parseAnalysis(analysis) {
        // Convert GPT's response into structured actions
        // This is a simplified version - you might want to make it more robust
        const actions = [];
        const lines = analysis.split('\n');
        
        for (const line of lines) {
            if (line.includes('click')) {
                actions.push({ type: 'click', selector: this.extractSelector(line) });
            } else if (line.includes('type')) {
                actions.push({ 
                    type: 'type', 
                    selector: this.extractSelector(line),
                    value: this.extractValue(line)
                });
            } else if (line.includes('submit')) {
                actions.push({ type: 'submit', selector: this.extractSelector(line) });
            }
        }

        return actions;
    }

    extractSelector(line) {
        // Extract CSS selector or element identifier from analysis line
        // This is a simplified version - enhance based on your needs
        const idMatch = line.match(/id="([^"]+)"/);
        if (idMatch) return `#${idMatch[1]}`;
        
        const classMatch = line.match(/class="([^"]+)"/);
        if (classMatch) return `.${classMatch[1]}`;
        
        // Default to any matching text
        const textMatch = line.match(/'([^']+)'/);
        if (textMatch) return `text="${textMatch[1]}"`;
        
        return null;
    }

    extractValue(line) {
        const valueMatch = line.match(/value="([^"]+)"/);
        return valueMatch ? valueMatch[1] : '';
    }

    async executeActions(actions) {
        const results = [];
        
        for (const action of actions) {
            try {
                switch (action.type) {
                    case 'click':
                        await this.page.click(action.selector);
                        results.push(`Clicked ${action.selector}`);
                        break;
                        
                    case 'type':
                        await this.page.type(action.selector, action.value);
                        results.push(`Typed into ${action.selector}`);
                        break;
                        
                    case 'submit':
                        await this.page.evaluate((selector) => {
                            document.querySelector(selector).submit();
                        }, action.selector);
                        results.push(`Submitted form ${action.selector}`);
                        break;
                }
                
                // Wait for network to be idle after each action
                await this.page.waitForNetworkIdle({ timeout: 3000 }).catch(() => {});
                
            } catch (error) {
                results.push(`Failed to execute ${action.type}: ${error.message}`);
            }
        }
        
        return results;
    }
}