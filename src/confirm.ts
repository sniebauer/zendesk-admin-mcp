export interface ToolTextResult {
  content: { type: "text"; text: string }[];
}

export interface GuardOptions {
  /** When false, return a preview and do NOT execute. When true, execute. */
  requireConfirm: boolean;
  /** Human-readable label, e.g. "delete trigger 5". */
  action: string;
  /** Fetches the object's current state for the preview. Only called when previewing. */
  fetchCurrent: () => Promise<unknown>;
  /** For updates: the proposed change to show alongside current state. */
  proposed?: unknown;
  /** Performs the actual mutation. Only called when confirming. */
  execute: () => Promise<unknown>;
}

export function asTextResult(value: unknown): ToolTextResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export async function runGuarded(opts: GuardOptions): Promise<ToolTextResult> {
  if (!opts.requireConfirm) {
    const current = await opts.fetchCurrent();
    return asTextResult({
      requires_confirmation: true,
      action: opts.action,
      message:
        "This is a guarded operation. Review the current state below, then re-invoke this tool with require_confirm: true to apply.",
      current_state: current,
      ...(opts.proposed !== undefined ? { proposed_change: opts.proposed } : {}),
    });
  }
  const result = await opts.execute();
  return asTextResult(result);
}
