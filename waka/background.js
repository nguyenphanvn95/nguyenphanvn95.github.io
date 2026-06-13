/**
 * background.js – Service Worker (MV3) v3.2
 * Phiên bản đơn giản – việc fetch đã chuyển sang MAIN world content script.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Waka DL] v3.5 installed. Fetching via MAIN world (waka.vn origin).');
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('epub_decoder.html') });
});
