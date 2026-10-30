/** Feedback and bug reports, shared by the website and the app: they open an email to us, already filled in. */
export const FEEDBACK_EMAIL = 'stevenlai441@gmail.com';

export interface FeedbackContext {
  /** Where it was sent from, such as "Website" or "iPhone app 1.0.29". */
  from: string;
  /** The browser or phone, so a bug can be tried on the same kind. */
  device: string;
}

/** A mailto: link with the subject and a short form to fill in, plus where it came from. */
export function feedbackMailto({ from, device }: FeedbackContext): string {
  const subject = `NY Transit Live feedback (${from})`;
  const body = [
    'What happened, or what would you like to see?',
    '',
    '',
    '',
    'If it was a bug: which line, station or vehicle, and roughly when?',
    '',
    '',
    '----',
    `Sent from: ${from}`,
    `Device: ${device}`,
  ].join('\n');
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
