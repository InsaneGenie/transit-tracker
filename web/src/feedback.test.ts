import { describe, expect, it } from 'vitest';
import { FEEDBACK_EMAIL, feedbackMailto } from './feedback';

describe('feedback', () => {
  it('fills in the subject and where it was sent from', () => {
    const url = new URL(feedbackMailto({ from: 'iPhone app 1.0.29', device: 'iOS 26.1' }));
    expect(url.protocol).toBe('mailto:');
    expect(url.pathname).toBe(FEEDBACK_EMAIL);
    expect(url.searchParams.get('subject')).toBe('NY Transit Live feedback (iPhone app 1.0.29)');
    const body = url.searchParams.get('body')!;
    expect(body).toContain('Sent from: iPhone app 1.0.29');
    expect(body).toContain('Device: iOS 26.1');
  });

  it('encodes spaces as %20, not +, so mail apps show them', () => {
    expect(feedbackMailto({ from: 'Website', device: 'a b' })).not.toContain('+');
  });
});
