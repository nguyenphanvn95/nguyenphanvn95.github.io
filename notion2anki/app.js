// Notion to Anki Web App
// Main application logic

class NotionToAnkiApp {
    constructor() {
        this.pages = [];
        this.notionData = null;
        this.editingIndex = null;
        this.init();
    }

    init() {
        this.loadFromLocalStorage();
        this.bindEvents();
        this.updateUI();
    }

    bindEvents() {
        document.getElementById('addItemBtn').addEventListener('click', () => this.openAddModal());
        document.getElementById('loadFromNotionBtn').addEventListener('click', () => this.loadFromNotion());
        document.getElementById('exportApkgBtn').addEventListener('click', () => this.exportApkg());
        document.getElementById('editTemplatesBtn').addEventListener('click', () => this.openTemplateEditor());

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
        this.editingIndex = null;
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

    editPage(index) {
        const page = this.pages[index];
        document.getElementById('modalPageId').value = page.pageId;
        document.getElementById('modalTargetDeck').value = page.targetDeck;
        this.editingIndex = index;
        document.getElementById('addPageModal').classList.add('active');
    }

    deletePage(index) {
        if (confirm('Bạn có chắc muốn xóa page này?')) {
            this.pages.splice(index, 1);
            this.saveConfig();
            this.updateUI();
            this.showNotification('Đã xóa page!', 'success');
        }
    }

    updateUI() {
        this.renderPagesTable();
        this.updateStats();
        document.getElementById('exportApkgBtn').disabled = !this.notionData || this.pages.length === 0;
    }

    renderPagesTable() {
        const tbody = document.getElementById('pagesTableBody');
        
        if (this.pages.length === 0) {
            tbody.innerHTML = `
                <tr class="empty-state">
                    <td colspan="3">
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
            
            row.innerHTML = `
                <td class="page-id-input" title="${page.pageId}">
                    ${page.pageId.substring(0, 12)}${page.pageId.length > 12 ? '...' : ''}
                </td>
                <td><span class="deck-badge">${page.targetDeck}</span></td>
                <td class="actions-cell">
                    <button class="action-btn action-btn-edit" onclick="app.editPage(${index})" title="Sửa">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn action-btn-delete" onclick="app.deletePage(${index})" title="Xóa">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;

            tbody.appendChild(row);
        });
    }

    updateStats() {
        document.getElementById('pagesCount').textContent = this.pages.length;
        
        // Calculate estimated cards more accurately
        let estimatedCards = 0;
        if (this.notionData && this.notionData.pages) {
            this.notionData.pages.forEach(page => {
                if (page.cards && Array.isArray(page.cards)) {
                    estimatedCards += page.cards.length;
                }
            });
        } else {
            estimatedCards = this.pages.length * 10; // Rough estimate
        }
        
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
            this.showNotification(`Tải dữ liệu thành công! Tổng cộng ${this.getTotalCards()} thẻ. Có thể xuất .apkg ngay.`, 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi: ' + error.message, 'error');
        }
    }

    getTotalCards() {
        if (!this.notionData || !this.notionData.pages) return 0;
        
        return this.notionData.pages.reduce((total, page) => {
            return total + (page.cards ? page.cards.length : 0);
        }, 0);
    }

    async fetchNotionPages(token) {
        const api = new NotionAPI(token);
        
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

    async exportApkg() {
        if (!this.notionData) {
            this.showNotification('Vui lòng tải dữ liệu từ Notion trước!', 'error');
            return;
        }

        try {
            this.showLoading(true);
            const deckName = document.getElementById('deckName').value || 'My Deck';
            const noteTypeName = 'Notion2Anki'; // Use fixed note type name
            
            await exportApkg(this.notionData, deckName, noteTypeName);
            
            this.showLoading(false);
            this.showNotification('Xuất file .apkg thành công!', 'success');
        } catch (error) {
            this.showLoading(false);
            this.showNotification('Lỗi khi tạo file: ' + error.message, 'error');
            console.error('Export error:', error);
        }
    }

    openTemplateEditor() {
        if (typeof openTemplateEditor === 'function') {
            openTemplateEditor();
        } else {
            this.showNotification('Template editor chưa được tải. Vui lòng tải lại trang.', 'error');
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

    if (app.editingIndex !== null) {
        // Edit existing page
        app.pages[app.editingIndex].pageId = pageId.replace(/-/g, '');
        app.pages[app.editingIndex].targetDeck = targetDeck;
        app.saveConfig();
        app.updateUI();
        app.showNotification('Đã sửa page thành công!', 'success');
        app.editingIndex = null;
    } else {
        // Add new page
        app.addPage(pageId, targetDeck);
    }
    
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