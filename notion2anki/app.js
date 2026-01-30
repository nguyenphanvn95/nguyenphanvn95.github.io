// Trong hàm fetchNotionPages, thay đổi cách gọi API
async fetchNotionPages(token) {
    // Try the new API first
    const api = new NotionAPI(token);
    
    // Test connection first
    this.showNotification('Đang kiểm tra kết nối Notion...', 'info');
    const isConnected = await api.testConnection();
    
    if (!isConnected) {
        this.showNotification('Token không hợp lệ hoặc không thể kết nối. Dùng dữ liệu mẫu.', 'warning');
        // Fall back to simple API
        return await this.fetchWithSimpleAPI();
    }
    
    const data = {
        pages: []
    };

    // Process each page
    for (let i = 0; i < this.pages.length; i++) {
        const page = this.pages[i];
        try {
            this.showNotification(`Đang xử lý page ${i + 1}/${this.pages.length}: ${page.targetDeck}...`, 'info');
            console.log(`Processing page ${i + 1}:`, page);
            
            // Use the new export method
            const blob = await api.exportPage(
                page.pageId, 
                page.recursive,
                (msg, progress) => {
                    console.log(`${page.targetDeck}: ${msg} (${progress}%)`);
                    // Optional: update progress in UI
                }
            );

            // Parse export to cards
            const cards = await api.parseExportToCards(blob, page.targetDeck);
            
            data.pages.push({
                id: page.pageId,
                deck: page.targetDeck,
                cards: cards
            });

            this.showNotification(`✓ Đã tải ${cards.length} thẻ từ ${page.targetDeck}`, 'success');
            console.log(`Page processed: ${cards.length} cards extracted`);
            
        } catch (error) {
            console.error(`Error processing page ${page.pageId}:`, error);
            this.showNotification(`Lỗi tải page ${page.targetDeck}: ${error.message}. Dùng dữ liệu mẫu.`, 'error');
            
            // Use mock data as fallback
            const mockCards = api.generateMockCards(page.targetDeck);
            data.pages.push({
                id: page.pageId,
                deck: page.targetDeck,
                cards: mockCards
            });
        }
    }

    console.log('All pages processed:', data);
    return data;
}

async fetchWithSimpleAPI() {
    const api = new NotionAPISimple();
    const data = {
        pages: []
    };
    
    for (const page of this.pages) {
        try {
            this.showNotification(`Đang tạo dữ liệu mẫu cho: ${page.targetDeck}...`, 'info');
            
            const blob = await api.exportPage(
                page.pageId, 
                page.recursive,
                (msg, progress) => {
                    console.log(`${page.targetDeck}: ${msg} (${progress}%)`);
                }
            );
            
            const cards = await api.parseExportToCards(blob, page.targetDeck);
            
            data.pages.push({
                id: page.pageId,
                deck: page.targetDeck,
                cards: cards
            });
            
            this.showNotification(`✓ Đã tạo ${cards.length} thẻ mẫu cho ${page.targetDeck}`, 'success');
            
        } catch (error) {
            console.error(`Error with simple API for ${page.targetDeck}:`, error);
            this.showNotification(`Lỗi tạo dữ liệu mẫu cho ${page.targetDeck}`, 'error');
        }
    }
    
    return data;
}