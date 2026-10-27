declare const CSInterface: new () => { evalScript(script: string, callback: (result: string) => void): void };

export function bind(button: HTMLButtonElement): void {
  const cs = new CSInterface();
  button.addEventListener("click", () => {
    cs.evalScript("placeText()", (result) => {
      button.textContent = result;
    });
  });
}
