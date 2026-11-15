/**
 * Hands a file to the user (§6.5): the iOS share sheet when available (Save to Files,
 * iCloud Drive, WhatsApp, Mail…), otherwise a regular download.
 */

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled' | 'needs-tap';

export function makeJsonFile(fileName: string, text: string): File {
  return new File([text], fileName, { type: 'application/json' });
}

/**
 * iOS only opens the share sheet during a user tap. Building the backup takes a moment, which
 * can expire the tap: then the result is 'needs-tap' and the UI shows a second button that calls
 * this again immediately with the ready file.
 */
export async function shareOrDownload(file: File): Promise<ShareOutcome> {
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-tap';
      // Any other failure: fall back to a download.
    }
  }
  download(file);
  return 'downloaded';
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
