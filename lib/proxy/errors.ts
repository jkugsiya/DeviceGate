// Anthropic's error shape, so Claude Code renders gateway denials as readable API errors.
type AnthropicErrorType =
  | "authentication_error"
  | "permission_error"
  | "invalid_request_error"
  | "rate_limit_error"
  | "not_found_error"
  | "api_error";

export function anthropicError(
  status: number,
  type: AnthropicErrorType,
  message: string,
  headers?: Record<string, string>,
): Response {
  return Response.json({ type: "error", error: { type, message } }, { status, headers });
}
