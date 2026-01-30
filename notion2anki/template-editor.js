// Template Editor for Notion to Anki
class TemplateEditor {
    constructor() {
        this.currentCardIndex = 0;
        this.model = null;
        this.init();
    }

    init() {
        this.loadModel();
        this.bindEvents();
        this.renderCardList();
        this.loadCurrentCard();
    }

    loadModel() {
        this.model = window.APKG_BUILDER ? window.APKG_BUILDER.loadApkgModel() : {
            globalCss: '',
            cards: [{ name: "Card 1", front: '', back: '' }]
        };
    }

    saveModel() {
        if (window.APKG_BUILDER) {
            window.APKG_BUILDER.saveApkgModel(this.model);
        } else {
            localStorage.setItem('notion_anki_model_v2', JSON.stringify(this.model));
        }
    }

    bindEvents() {
        // Card management
        const addCardBtn = document.getElementById('addCardBtn');
        const deleteCardBtn = document.getElementById('deleteCardBtn');
        const duplicateCardBtn = document.getElementById('duplicateCardBtn');
        const saveTemplateBtn = document.getElementById('saveTemplateBtn');
        const resetTemplateBtn = document.getElementById('resetTemplateBtn');
        const closeTplBtn = document.getElementById('closeTplBtn');
        const cancelTplBtn = document.getElementById('cancelTplBtn');
        
        if (addCardBtn) addCardBtn.addEventListener('click', () => this.addCard());
        if (deleteCardBtn) deleteCardBtn.addEventListener('click', () => this.deleteCard());
        if (duplicateCardBtn) duplicateCardBtn.addEventListener('click', () => this.duplicateCard());
        if (saveTemplateBtn) saveTemplateBtn.addEventListener('click', () => this.saveTemplate());
        if (resetTemplateBtn) resetTemplateBtn.addEventListener('click', () => this.resetTemplate());
        if (closeTplBtn) closeTplBtn.addEventListener('click', () => this.closeModal());
        if (cancelTplBtn) cancelTplBtn.addEventListener('click', () => this.closeModal());
        
        // Card list selection
        const cardList = document.getElementById('cardList');
        if (cardList) {
            cardList.addEventListener('change', (e) => {
                this.currentCardIndex = parseInt(e.target.value);
                this.loadCurrentCard();
            });
        }
        
        // Input changes
        const cardNameInput = document.getElementById('cardNameInput');
        const frontTemplate = document.getElementById('frontTemplate');
        const backTemplate = document.getElementById('backTemplate');
        const globalCss = document.getElementById('globalCss');
        
        if (cardNameInput) {
            cardNameInput.addEventListener('input', (e) => {
                this.model.cards[this.currentCardIndex].name = e.target.value;
                this.renderCardList();
            });
        }
        
        if (frontTemplate) {
            frontTemplate.addEventListener('input', (e) => {
                this.model.cards[this.currentCardIndex].front = e.target.value;
            });
        }
        
        if (backTemplate) {
            backTemplate.addEventListener('input', (e) => {
                this.model.cards[this.currentCardIndex].back = e.target.value;
            });
        }
        
        if (globalCss) {
            globalCss.addEventListener('input', (e) => {
                this.model.globalCss = e.target.value;
            });
        }
    }

    renderCardList() {
        const cardList = document.getElementById('cardList');
        if (!cardList) return;
        
        cardList.innerHTML = '';
        this.model.cards.forEach((card, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = card.name || `Card ${index + 1}`;
            cardList.appendChild(option);
        });
        
        cardList.value = this.currentCardIndex;
    }

    loadCurrentCard() {
        const card = this.model.cards[this.currentCardIndex];
        if (!card) return;
        
        const cardNameInput = document.getElementById('cardNameInput');
        const frontTemplate = document.getElementById('frontTemplate');
        const backTemplate = document.getElementById('backTemplate');
        const globalCss = document.getElementById('globalCss');
        
        if (cardNameInput) cardNameInput.value = card.name || '';
        if (frontTemplate) frontTemplate.value = card.front || '';
        if (backTemplate) backTemplate.value = card.back || '';
        if (globalCss) globalCss.value = this.model.globalCss || '';
    }

    addCard() {
        const newCard = {
            name: `Card ${this.model.cards.length + 1}`,
            front: '{{Front}}',
            back: '{{FrontSide}}<hr id="answer">{{Back}}'
        };
        
        this.model.cards.push(newCard);
        this.currentCardIndex = this.model.cards.length - 1;
        this.renderCardList();
        this.loadCurrentCard();
    }

    deleteCard() {
        if (this.model.cards.length <= 1) {
            alert('Phải có ít nhất một card type!');
            return;
        }
        
        if (confirm('Bạn có chắc muốn xóa card type này?')) {
            this.model.cards.splice(this.currentCardIndex, 1);
            this.currentCardIndex = Math.max(0, this.currentCardIndex - 1);
            this.renderCardList();
            this.loadCurrentCard();
        }
    }

    duplicateCard() {
        const currentCard = this.model.cards[this.currentCardIndex];
        const newCard = {
            name: `${currentCard.name} (Copy)`,
            front: currentCard.front,
            back: currentCard.back
        };
        
        this.model.cards.splice(this.currentCardIndex + 1, 0, newCard);
        this.currentCardIndex++;
        this.renderCardList();
        this.loadCurrentCard();
    }

    saveTemplate() {
        this.saveModel();
        
        // Show success message
        const notification = document.getElementById('templateNotification');
        if (notification) {
            notification.textContent = 'Đã lưu template!';
            notification.className = 'notification success show';
            setTimeout(() => {
                notification.className = 'notification';
            }, 3000);
        }
        
        this.closeModal();
    }

    async resetTemplate() {
        if (confirm('Bạn có chắc muốn reset template về mặc định?')) {
            if (window.APKG_BUILDER) {
                await window.APKG_BUILDER.resetApkgModel();
                this.loadModel();
            } else {
                localStorage.removeItem('notion_anki_model_v2');
                this.model = {
                    globalCss: '',
                    cards: [{ name: "Card 1", front: '{{Front}}', back: '{{FrontSide}}<hr id="answer">{{Back}}' }]
                };
            }
            
            this.currentCardIndex = 0;
            this.renderCardList();
            this.loadCurrentCard();
            
            // Show notification
            const notification = document.getElementById('templateNotification');
            if (notification) {
                notification.textContent = 'Đã reset template về mặc định!';
                notification.className = 'notification success show';
                setTimeout(() => {
                    notification.className = 'notification';
                }, 3000);
            }
        }
    }

    openModal() {
        document.getElementById('templateModal').classList.add('active');
    }

    closeModal() {
        document.getElementById('templateModal').classList.remove('active');
    }
}

// Global functions
let templateEditor;

function openTemplateEditor() {
    if (!templateEditor) {
        templateEditor = new TemplateEditor();
    }
    templateEditor.openModal();
}

function closeTemplateEditor() {
    if (templateEditor) {
        templateEditor.closeModal();
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize template editor
    templateEditor = new TemplateEditor();
    
    // Add Edit Template button to the page if not exists
    const exportCard = document.querySelector('.card:last-child');
    if (exportCard) {
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary';
        editBtn.id = 'editTemplatesBtn';
        editBtn.innerHTML = '<i class="fas fa-pen"></i> Sửa Template';
        editBtn.onclick = openTemplateEditor;
        
        const actionsDiv = exportCard.querySelector('.actions');
        if (actionsDiv) {
            // Insert before the last button (Export .apkg)
            const exportBtn = actionsDiv.querySelector('#exportApkgBtn');
            if (exportBtn) {
                actionsDiv.insertBefore(editBtn, exportBtn);
            } else {
                actionsDiv.appendChild(editBtn);
            }
        }
    }
});