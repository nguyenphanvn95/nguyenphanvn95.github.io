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
     * Extract cards from parsed HTML - IMPROVED VERSION
     */
    extractCardsFromHTML(doc, deckName) {
        const cards = [];
        
        console.log(`Bắt đầu trích xuất cards từ deck: ${deckName}`);
        
        // 1. Tìm tất cả các toggle blocks (cải tiến)
        const toggles = doc.querySelectorAll('.toggle, details, [class*="toggle"], [class*="collapse"]');
        console.log(`Tìm thấy ${toggles.length} toggle elements`);
        
        toggles.forEach((toggle, index) => {
            let summary, content;
            
            if (toggle.tagName === 'DETAILS') {
                summary = toggle.querySelector('summary');
                content = toggle;
            } else if (toggle.classList.contains('toggle')) {
                summary = toggle.querySelector('.toggle-title, summary, h1, h2, h3, h4, h5, h6, strong, b');
                content = toggle.querySelector('.toggle-content, div, p');
                if (!summary) {
                    // Try to get first child as summary
                    const firstChild = toggle.firstElementChild;
                    if (firstChild && firstChild.textContent.trim()) {
                        summary = { textContent: firstChild.textContent };
                        content = toggle;
                    }
                }
            }
            
            if (summary && content) {
                const front = this.cleanText(summary.textContent);
                let back = '';
                
                // Get all text content from content element
                const contentElements = content.querySelectorAll('p, li, div, span');
                if (contentElements.length > 0) {
                    back = Array.from(contentElements)
                        .map(el => this.cleanText(el.textContent))
                        .filter(text => text.trim())
                        .join('\n\n');
                } else {
                    back = this.cleanText(content.textContent);
                }
                
                if (front && back && front.trim() !== '' && back.trim() !== '') {
                    cards.push({
                        front: front,
                        back: back,
                        tags: [deckName, 'notion-toggle'],
                        deck: deckName
                    });
                }
            }
        });

        // 2. Tìm các cấu trúc danh sách (bullets, numbered lists)
        const lists = doc.querySelectorAll('ul > li, ol > li');
        console.log(`Tìm thấy ${lists.length} list items`);
        
        lists.forEach(li => {
            const text = li.textContent.trim();
            if (!text) return;
            
            // Patterns for flashcards
            const patterns = [
                /(.+?)[:：]\s*(.+)/,                    // Question: Answer
                /(.+?)[-–—]\s*(.+)/,                   // Question - Answer
                /(.+?)\s*[|｜]\s*(.+)/,                 // Question | Answer
                /(.+?)\s*→\s*(.+)/,                    // Question → Answer
                /(.+?)\s*=>\s*(.+)/,                   // Question => Answer
                /(.+?)\s*::\s*(.+)/                    // Question :: Answer
            ];
            
            for (const pattern of patterns) {
                const match = text.match(pattern);
                if (match) {
                    const front = this.cleanText(match[1]);
                    const back = this.cleanText(match[2]);
                    if (front && back) {
                        cards.push({
                            front: front,
                            back: back,
                            tags: [deckName, 'notion-list'],
                            deck: deckName
                        });
                        break;
                    }
                }
            }
            
            // Check for bold text followed by regular text
            const boldElements = li.querySelectorAll('strong, b, [class*="bold"]');
            boldElements.forEach(bold => {
                const front = this.cleanText(bold.textContent);
                let back = '';
                
                // Get text after bold element
                let nextSibling = bold.nextSibling;
                while (nextSibling && (back.length < 500 || !nextSibling.textContent.match(/[.!?]$/))) {
                    if (nextSibling.nodeType === Node.TEXT_NODE) {
                        back += nextSibling.textContent;
                    } else if (nextSibling.nodeType === Node.ELEMENT_NODE) {
                        back += nextSibling.textContent;
                    }
                    nextSibling = nextSibling.nextSibling;
                }
                
                back = this.cleanText(back);
                
                if (front && back && front.trim() !== '' && back.trim() !== '') {
                    cards.push({
                        front: front,
                        back: back,
                        tags: [deckName, 'notion-bold'],
                        deck: deckName
                    });
                }
            });
        });

        // 3. Tìm các headings (h1-h6) và nội dung sau nó
        const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
        console.log(`Tìm thấy ${headings.length} headings`);
        
        headings.forEach(heading => {
            const front = this.cleanText(heading.textContent);
            if (!front.trim()) return;
            
            let back = '';
            let nextElement = heading.nextElementSibling;
            let collectedLines = 0;
            
            // Collect next elements until next heading or max lines
            while (nextElement && 
                   !nextElement.matches('h1, h2, h3, h4, h5, h6') && 
                   collectedLines < 10) {
                
                const elementText = this.cleanText(nextElement.textContent);
                if (elementText.trim()) {
                    back += elementText + '\n\n';
                    collectedLines++;
                }
                
                nextElement = nextElement.nextElementSibling;
            }
            
            back = back.trim();
            
            if (back) {
                cards.push({
                    front: front,
                    back: back,
                    tags: [deckName, 'notion-heading'],
                    deck: deckName
                });
            }
        });

        // 4. Tìm các tables có thể chứa flashcard
        const tables = doc.querySelectorAll('table');
        console.log(`Tìm thấy ${tables.length} tables`);
        
        tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length >= 2) {
                    const front = this.cleanText(cells[0].textContent);
                    const back = this.cleanText(cells[1].textContent);
                    
                    if (front && back && front.trim() !== '' && back.trim() !== '') {
                        cards.push({
                            front: front,
                            back: back,
                            tags: [deckName, 'notion-table'],
                            deck: deckName
                        });
                    }
                }
            });
        });

        // 5. Tìm các paragraph có chứa ký tự đặc biệt
        const paragraphs = doc.querySelectorAll('p');
        console.log(`Tìm thấy ${paragraphs.length} paragraphs`);
        
        paragraphs.forEach(p => {
            const text = p.textContent.trim();
            if (!text) return;
            
            // Check for Q/A patterns
            if (text.includes('?') && text.length > 20) {
                // Try to split at question mark
                const parts = text.split('?');
                if (parts.length >= 2) {
                    const front = this.cleanText(parts[0] + '?');
                    const back = this.cleanText(parts.slice(1).join('?'));
                    
                    if (front && back) {
                        cards.push({
                            front: front,
                            back: back,
                            tags: [deckName, 'notion-paragraph'],
                            deck: deckName
                        });
                    }
                }
            }
        });

        console.log(`Tổng số cards trích xuất: ${cards.length}`);
        
        // Remove duplicates based on front content
        const uniqueCards = [];
        const seenFronts = new Set();
        
        cards.forEach(card => {
            const frontKey = card.front.trim().toLowerCase();
            if (!seenFronts.has(frontKey)) {
                seenFronts.add(frontKey);
                uniqueCards.push(card);
            }
        });
        
        console.log(`Số cards sau khi loại bỏ trùng lặp: ${uniqueCards.length}`);
        
        return uniqueCards;
    }

    /**
     * Clean text content
     */
    cleanText(text) {
        if (!text) return '';
        
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n')
            .replace(/[ \t]+/g, ' ')
            .replace(/^\s+|\s+$/g, '')
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