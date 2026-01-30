// Notion to Anki Web App
// Main application logic

class NotionToAnkiApp {
    constructor() {
        this.pages = [];
        this.notionData = null;
        this.selectedPageIndex = null;
        this.init();
    }

    init() {
        this.loadFromLocalStorage();
        this.bindEvents();
        this.updateUI();
    }

    bindEvents() {
        document.getElementById('addItemBtn').addEventListener('click', () => this.openAddModal());
        document.getElementById('deleteItemBtn').addEventListener('click', () => this.deleteSelectedPage());
        document.getElementById('loadFromNotionBtn').addEventListener('click', () => this.loadFromNotion());
        document.getElementById('exportApkgBtn').addEventListener('click', () => this.exportApkg());

        // Save configuration on change
        document.getElementById('notionToken').addEventListener('input', () => this.saveConfig());
        document.getElementById('notionNamespace').addEventListener('input', () => this.saveConfig());
        document.getElementById('deckName').addEventListener('input', () => this.saveConfig());
    }

    loadFromLocalStorage() {
        const saved = localStorage.getItem('notionToAnkiConfig');
        if (saved) {
            const config = JSON.parse(saved);
            document.getElementById('notionToken').value = config.token || '';
            document.getElementById('notionNamespace').value = config.namespace || '';
            document.getElementById('deckName').value = config.deckName || 'My Deck';
            this.pages = config.pages || [];
        }
    }

    saveConfig() {
        const config = {
            token: document.getElementById('notionToken').value,
            namespace: document.getElementById('notionNamespace').value,
            deckName: document.getElementById('deckName').value,
            pages: this.pages
        };
        localStorage.setItem('notionToAnkiConfig', JSON.stringify(config));
    }

    openAddModal() {
        document.getElementById('addPageModal').classList.add('active');
        document.getElementById('modalPageId').value = '';
        document.getElementById('modalTargetDeck').value = '';
        document.getElementById('modalPageId').focus();
    }

    addPage(pageId, targetDeck) {
        // Clean up pageId - remove hyphens if present
        pageId = pageId.replace(/-/g, '');
        
        const page = {
            pageId: pageId,
            targetDeck: targetDeck,
            recursive: true,
            absUpdate: false,
            incUpdate: true
        };

        this.pages.push(page);
        this.saveConfig();
        this.updateUI();
        this.showNotification('Đã thêm page thành công!', 'success');
    }

    deleteSelectedPage() {
        if (this.selectedPageIndex !== null) {
            if (confirm('Bạn có chắc muốn xóa page này?')) {
                this.pages.splice(this.selectedPageIndex, 1);
                this.selectedPageIndex = null;
                this.saveConfig();
                this.updateUI();
                this.showNotification('Đã xóa page!', 'success');
            }
        }
    }

    updateUI() {
        this.renderPagesTable();
        this.updateStats();
        document.getElementById('deleteItemBtn').disabled = this.selectedPageIndex === null;
        document.getElementById('exportApkgBtn').disabled = !this.notionData || this.pages.length === 0;
    }

    renderPagesTable() {
        const tbody = document.getElementById('pagesTableBody');
        
        if (this.pages.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="5">
                        <i class="fas fa-inbox"></i>
                        <p>Chưa có pages nào. Nhấn "Add Item" để thêm.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = '';
        this.pages.forEach((page, index) => {
            const row = document.createElement('tr');
            row.style.cursor = 'pointer';
            
            if (index === this.selectedPageIndex) {
                row.style.background = '#e3f2fd';
            }

            row.addEventListener('click', () => {
                this.selectedPageIndex = index;
                this.updateUI();
            });

            row.innerHTML = `
                <td class="page-id-input">${page.pageId.substring(0, 12)}...</td>
                <td><span class="deck-badge">${page.targetDeck}</span></td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${page.recursive ? 'checked' : ''} 
                           onchange="app.togglePageOption(${index}, 'recursive')">
                </td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${page.absUpdate ? 'checked' : ''} 
                           onchange="app.togglePageOption(${index}, 'absUpdate')">
                </td>
                <td class="checkbox-cell">
                    <input type="checkbox" ${page.incUpdate ? 'checked' : ''} 
                           onchange="app.togglePageOption(${index}, 'incUpdate')">
                </td>
            `;

            tbody.appendChild(row);
        });
    }

    togglePageOption(index, option) {
        this.pages[index][option] = !this.pages[index][option];
        this.saveConfig();
    }

    updateStats() {
        document.getElementById('pagesCount').textContent = this.pages.length;
        const estimatedCards = this.pages.length * 10; // Rough estimate
        document.getElementById('cardsCount').textContent = estimatedCards;
    }

    async loadFromNotion() {
        const token = document.getElementById('notionToken').value.trim();
        
        if (!token) {
            this.showNotification('Vui lòng nhập Notion Token!', 'error');
            return;
        }

        if (this.pages.length === 0) {
            this.showNotification('Vui lòng thêm ít nhất một page!', 'error');
            return;
        }

        try {
            this.showLoading(true);
            this.notionData = await this.fetchNotionPages(token);
            this.showLoading(false);
            this.updateUI();
            this.showNotification('Tải dữ liệu thành công! Có thể xuất .apkg ngay.', 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi: ' + error.message, 'error');
        }
    }

    async fetchNotionPages(token) {
        // Use simple API for demo (works without CORS issues)
        // For production, use NotionAPI class with proper CORS proxy
        const api = new NotionAPISimple();
        
        const data = {
            pages: []
        };

        // Process each page
        for (const page of this.pages) {
            try {
                this.showNotification(`Đang xử lý page: ${page.targetDeck}...`, 'info');
                
                // Export page from Notion
                const blob = await api.exportPage(
                    page.pageId, 
                    page.recursive,
                    (msg, progress) => {
                        console.log(`${page.targetDeck}: ${msg} (${progress}%)`);
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
                
            } catch (error) {
                console.error(`Error processing page ${page.pageId}:`, error);
                this.showNotification(`Lỗi tải page ${page.targetDeck}: ${error.message}`, 'error');
            }
        }

        return data;
    }

    // Use real Notion API (requires CORS proxy or backend)
    async fetchNotionPagesReal(token) {
        const api = new NotionAPI(token);
        
        const data = {
            pages: []
        };

        // Test connection first
        try {
            await api.testConnection();
        } catch (error) {
            throw new Error('Không thể kết nối với Notion API. Vui lòng kiểm tra Token.');
        }

        // Process each page
        for (const page of this.pages) {
            try {
                this.showNotification(`Đang xử lý page: ${page.targetDeck}...`, 'info');
                
                // Export page from Notion
                const blob = await api.exportPage(
                    page.pageId, 
                    page.recursive,
                    (msg, progress) => {
                        console.log(`${page.targetDeck}: ${msg} (${progress}%)`);
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
                
            } catch (error) {
                console.error(`Error processing page ${page.pageId}:`, error);
                this.showNotification(`Lỗi tải page ${page.targetDeck}: ${error.message}`, 'error');
            }
        }

        return data;
    }

    async exportApkg() {
        if (!this.notionData) {
            this.showNotification('Vui lòng tải dữ liệu từ Notion trước!', 'error');
            return;
        }

        try {
            this.showLoading(true);
            const deckName = document.getElementById('deckName').value || 'My Deck';
            const noteTypeName = loadNoteType(); // Use the apkg-builder function
            
            await exportApkg(this.notionData, deckName, noteTypeName);
            
            this.showLoading(false);
            this.showNotification('Xuất file .apkg thành công!', 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi khi tạo file: ' + error.message, 'error');
            console.error('Export error:', error);
        }
    }

    showLoading(show) {
        const loading = document.getElementById('loadingIndicator');
        if (show) {
            loading.classList.add('active');
        } else {
            loading.classList.remove('active');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        const icon = document.getElementById('notificationIcon');
        const text = document.getElementById('notificationText');

        // Set icon based on type
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            info: 'fas fa-info-circle'
        };

        notification.className = `notification ${type}`;
        icon.className = icons[type];
        text.textContent = message;

        notification.style.display = 'flex';

        setTimeout(() => {
            notification.style.display = 'none';
        }, 5000);
    }
}

// Global functions for modal
function closeAddModal() {
    document.getElementById('addPageModal').classList.remove('active');
}

function confirmAddPage() {
    const pageId = document.getElementById('modalPageId').value.trim();
    const targetDeck = document.getElementById('modalTargetDeck').value.trim();

    if (!pageId || !targetDeck) {
        app.showNotification('Vui lòng điền đầy đủ thông tin!', 'error');
        return;
    }

    app.addPage(pageId, targetDeck);
    closeAddModal();
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('addPageModal');
    if (e.target === modal) {
        closeAddModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAddModal();
    }
});

// Initialize app
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new NotionToAnkiApp();
});
