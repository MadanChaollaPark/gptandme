
let promptCount = 0;

const sendButton = document.getElementById('send-button');
const promptTextarea = document.getElementById('prompt-textarea');

sendButton.addEventListener('click', () => {
  if (promptTextarea.value.trim() !== '') {
    promptCount++;
    console.log(`Prompt count: ${promptCount}`);
  }
});
