/**
 * Turns an error message from the API or a wallet into something a person can read after
 * "Couldn't <do the thing>: ". Hides server configuration details and strips repeated
 * "<action> failed:" prefixes so messages don't read twice.
 */
export function friendlyReason(message: string, fallback = "something went wrong"): string {
  const text = message.trim();
  if (/not configured|are not set|is not set|PRIVATE_KEY|NEAR_[A-Z_]+|DEMO_[A-Z_]+|Relayer is not configured/i.test(text)) {
    return "this service is temporarily unavailable. Please try again shortly";
  }
  if (/demo faucet/i.test(text)) return "test tokens are only available on the test network";
  const stripped = text.replace(/^(payment|claim|refund|release|faucet|draft|publish|create_offer|quote) failed:?\s*/i, "");
  return stripped || fallback;
}
