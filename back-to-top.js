//Chèn vào trang web cần: <script src="back-to-top.js"></script> nút sẽ hiện bên trái dưới
// Tạo nút quay lên đầu trang
const backToTopBtn = document.createElement('div');
backToTopBtn.id = 'vliBackToTop';
backToTopBtn.className = 'vli-back-to-top';
backToTopBtn.innerHTML = '<div class="vli-back-to-top-icon"></div>';
document.body.appendChild(backToTopBtn);

// Tạo style cho nút
const style = document.createElement('style');
style.textContent = `
.vli-back-to-top {
    position: fixed;
    bottom: 30px;
    left: 30px;
    width: 60px;
    height: 60px;
    background: linear-gradient(135deg, #3498db, #1a5276);
    border-radius: 50%;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transform: translateY(20px);
    transition: all 0.4s ease;
    z-index: 1000;
    text-decoration: none;
}

.vli-back-to-top.show {
    opacity: 1;
    transform: translateY(0);
}

.vli-back-to-top:hover {
    background: linear-gradient(135deg, #2980b9, #154360);
    transform: translateY(-5px);
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
}

.vli-back-to-top:active {
    transform: scale(0.95);
}

.vli-back-to-top-icon {
    width: 30px;
    height: 30px;
    position: relative;
}

.vli-back-to-top-icon::before {
    content: "";
    position: absolute;
    top: 50%;
    left: 50%;
    width: 20px;
    height: 20px;
    border-top: 3px solid white;
    border-left: 3px solid white;
    transform: translate(-50%, -25%) rotate(45deg);
}
`;
document.head.appendChild(style);

// Xử lý sự kiện scroll
window.addEventListener('scroll', function() {
    if (window.pageYOffset > 300) {
        backToTopBtn.classList.add('show');
    } else {
        backToTopBtn.classList.remove('show');
    }
});

// Xử lý sự kiện click
backToTopBtn.addEventListener('click', function(e) {
    e.preventDefault();
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
});