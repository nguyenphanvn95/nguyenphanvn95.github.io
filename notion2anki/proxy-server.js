// Simple proxy server for Notion API
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.post('/api/proxy', async (req, res) => {
    try {
        const { token, method, endpoint, data } = req.body;
        
        const url = `https://api.notion.com/v1${endpoint}`;
        
        const response = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28'
            },
            body: data ? JSON.stringify(data) : undefined
        });
        
        const responseData = await response.json();
        
        res.json({
            success: response.ok,
            status: response.status,
            data: responseData
        });
    } catch (error) {
        console.error('Proxy error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
});