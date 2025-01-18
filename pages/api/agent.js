import { WebAgent } from '../../lib/webAgent';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { url, task } = req.body;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!url || !task) {
        return res.status(400).json({ error: 'URL and task are required' });
    }

    try {
        const agent = new WebAgent(openaiKey);
        await agent.initialize();
        
        const result = await agent.executeTask(url, task);
        await agent.close();

        res.status(200).json(result);
    } catch (error) {
        console.error('Agent error:', error);
        res.status(500).json({ error: error.message });
    }
}