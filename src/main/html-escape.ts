/** Text made safe to put inside HTML - for the sign-in pages the app serves
 *  itself, where provider error codes and account names are shown. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
