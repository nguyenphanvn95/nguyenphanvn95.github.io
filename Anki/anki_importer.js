<script>
(async () => {
  const scriptUrl = "https://mrntn161.github.io/langki_anki/anki.js";
  const scriptId = "text";

  await loadScriptOrMirror(scriptUrl, scriptId);

  // Hàm tải script hoặc sao chép nội dung nếu đã có sẵn
  async function loadScriptOrMirror(url, id) {
    try {
      // Nếu đã có script với ID đó, sao chép nội dung vào thẻ mới rồi xoá sau 100ms
      const existingScript = document.getElementById(id);
      if (existingScript) {
        const tempScript = document.createElement("script");
        tempScript.innerHTML = existingScript.innerHTML;
        document.body.appendChild(tempScript);
        setTimeout(() => {
          tempScript.remove();
        }, 100);
        return;
      }

      // Nếu chưa có, tải từ URL và thêm vào <body>
      const response = await fetch(url);
      const scriptContent = await response.text();

      const scriptElement = document.createElement("script");
      scriptElement.setAttribute("id", id);
      scriptElement.text = scriptContent;
      document.body.prepend(scriptElement);
    } catch (error) {
      console.error(error);
    }
  }
})();
</script>
