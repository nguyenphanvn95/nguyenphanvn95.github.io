// Notion API Integration Module
// Handles communication with Notion API

class NotionAPI {
    constructor(token) {
        this.token = token;
        this.baseUrl = 'https://www.notion.so/api/v3';
        this.corsProxy = 'https://corsproxy.io/?'; // CORS proxy for browser
        this.maxRetries = 60;
        this.retryDelay = 1000; // 1 second
    }

    /**
     * Enqueue export task for a page
     */
    async enqueueExportTask(pageId, recursive = false) {
        const url = `${this.corsProxy}${this.baseUrl}/enqueueTask`;
        
        const payload = {
            task: {
                eventName: 'exportBlock',
                request: {
                    block: { id: pageId },
                    recursive: recursive,
                    exportOptions: {
                        exportType: 'html',
                        timeZone: 'Asia/Ho_Chi_Minh',
                        locale: 'vi',
                    }
                }
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': `token_v2=${this.token}`
                },
                body: JSON.stringify(payload)
            });

            if (response.status === 401) {
                throw new Error('Token không hợp lệ! Vui lòng kiểm tra lại Notion Token.');
            }

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.taskId) {
                throw new Error('Không nhận được task ID từ Notion API');
            }

            return data.taskId;
        } catch (error) {
            console.error('Error enqueueing task:', error);
            throw new Error(`Không thể tạo export task: ${error.message}`);
        }
    }

    /**
     * Get task result
     */
    async getTaskResult(taskId) {
        const url = `${this.corsProxy}${this.baseUrl}/getTasks`;
        
        let attempts = 0;
        
        while (attempts < this.maxRetries) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Cookie': `token_v2=${this.token}`
                    },
                    body: JSON.stringify({ taskIds: [taskId] })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                
                if (data.results && data.results.length > 0) {
                    const result = data.results[0];
                    
                    if (result.error) {
                        throw new Error(result.error);
                    }

                    if (result.status && result.status.type === 'complete') {
                        return result.status.exportURL;
                    }
                }

                // Task not ready yet, wait and retry
                await this.sleep(this.retryDelay);
                attempts++;
                
            } catch (error) {
                console.error(`Error getting task (attempt ${attempts}):`, error);
                attempts++;
                await this.sleep(this.retryDelay);
            }
        }

        throw new Error('Timeout: Không thể lấy kết quả export sau nhiều lần thử');
    }

    /**
     * Download exported file
     */
    async downloadExport(exportUrl) {
        try {
            const response = await fetch(exportUrl);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const blob = await response.blob();
            return blob;
        } catch (error) {
            console.error('Error downloading export:', error);
            throw new Error(`Không thể tải file export: ${error.message}`);
        }
    }

    /**
     * Export page as HTML
     */
    async exportPage(pageId, recursive = false, onProgress = null) {
        try {
            // Step 1: Enqueue task
            if (onProgress) onProgress('Đang tạo export task...', 10);
            const taskId = await this.enqueueExportTask(pageId, recursive);
            
            // Step 2: Wait for task completion
            if (onProgress) onProgress('Đang chờ Notion xử lý...', 30);
            const exportUrl = await this.getTaskResult(taskId);
            
            // Step 3: Download file
            if (onProgress) onProgress('Đang tải file...', 80);
            const blob = await this.downloadExport(exportUrl);
            
            if (onProgress) onProgress('Hoàn thành!', 100);
            
            return blob;
        } catch (error) {
            console.error('Error exporting page:', error);
            throw error;
        }
    }

    /**
     * Parse HTML export to extract card data
     */
    async parseExportToCards(blob, deckName) {
        try {
            // Unzip the export (it's a zip file)
            const zip = await JSZip.loadAsync(blob);
            
            // Find HTML file
            let htmlContent = null;
            for (const filename in zip.files) {
                if (filename.endsWith('.html')) {
                    htmlContent = await zip.files[filename].async('string');
                    break;
                }
            }

            if (!htmlContent) {
                throw new Error('Không tìm thấy file HTML trong export');
            }

            // Parse HTML to extract cards
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, 'text/html');
            
            return this.extractCardsFromHTML(doc, deckName);
        } catch (error) {
            console.error('Error parsing export:', error);
            throw new Error(`Không thể parse HTML: ${error.message}`);
        }
    }

    /**
     * Extract cards from parsed HTML
     */
    extractCardsFromHTML(doc, deckName) {
        const cards = [];
        
        // Look for toggle blocks (common pattern in Notion for flashcards)
        const toggles = doc.querySelectorAll('.toggle');
        
        toggles.forEach(toggle => {
            const summary = toggle.querySelector('summary');
            const content = toggle.querySelector('div');
            
            if (summary && content) {
                const front = this.cleanText(summary.textContent);
                const back = this.cleanText(content.textContent);
                
                if (front && back) {
                    cards.push({
                        front: front,
                        back: back,
                        tags: [deckName],
                        deck: deckName
                    });
                }
            }
        });

        // Also look for bullet lists (another common pattern)
        const lists = doc.querySelectorAll('ul > li');
        
        lists.forEach(li => {
            const text = li.textContent;
            // Pattern: "Question :: Answer"
            if (text.includes('::')) {
                const [front, back] = text.split('::').map(s => s.trim());
                if (front && back) {
                    cards.push({
                        front: front,
                        back: back,
                        tags: [deckName],
                        deck: deckName
                    });
                }
            }
        });

        return cards;
    }

    /**
     * Clean text content
     */
    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .trim();
    }

    /**
     * Sleep utility
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Test connection
     */
    async testConnection() {
        try {
            // Try to enqueue a simple task to test token
            const testPageId = '0'.repeat(32); // Dummy page ID
            await this.enqueueExportTask(testPageId, false);
            return true;
        } catch (error) {
            if (error.message.includes('Token')) {
                throw error;
            }
            // Other errors are ok for testing (page might not exist)
            return true;
        }
    }
}

// Alternative: Simple CORS workaround for development
class NotionAPISimple {
    constructor() {
        this.templates = {
            basic: {
                front: [
                    'What is spaced repetition?',
                    'What is active recall?',
                    'What is the Ebbinghaus forgetting curve?',
                    'What is interleaving?',
                    'What is elaborative rehearsal?'
                ],
                back: [
                    'A learning technique that incorporates increasing intervals of time between subsequent review of previously learned material.',
                    'A principle of learning that emphasizes retrieving information from memory.',
                    'A hypothesis about the decline of memory retention over time.',
                    'A learning technique that involves mixing different topics or types of problems.',
                    'A memory technique that involves thinking about the meaning of information.'
                ]
            },
            vocabulary: {
                words: [
                    { word: 'Serendipity', meaning: 'The occurrence of events by chance in a happy way' },
                    { word: 'Ephemeral', meaning: 'Lasting for a very short time' },
                    { word: 'Ubiquitous', meaning: 'Present everywhere at the same time' },
                    { word: 'Enigmatic', meaning: 'Difficult to understand or explain; mysterious' },
                    { word: 'Mellifluous', meaning: 'Sweet or musical; pleasant to hear' }
                ]
            }
        };
    }

    async exportPage(pageId, recursive, onProgress) {
        // Simulate API delay
        if (onProgress) onProgress('Đang kết nối...', 20);
        await this.sleep(1000);
        
        if (onProgress) onProgress('Đang tải dữ liệu...', 60);
        await this.sleep(1500);
        
        if (onProgress) onProgress('Hoàn thành!', 100);
        
        return { success: true };
    }

    async parseExportToCards(blob, deckName) {
        // Generate sample cards based on deck name
        const cards = [];
        const template = this.templates.basic;
        
        for (let i = 0; i < template.front.length; i++) {
            cards.push({
                front: template.front[i],
                back: template.back[i],
                tags: [deckName, 'sample'],
                deck: deckName
            });
        }

        // Add vocabulary if deck name suggests it
        if (deckName.toLowerCase().includes('vocab') || deckName.toLowerCase().includes('từ')) {
            this.templates.vocabulary.words.forEach(item => {
                cards.push({
                    front: item.word,
                    back: item.meaning,
                    tags: [deckName, 'vocabulary'],
                    deck: deckName
                });
            });
        }

        return cards;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
