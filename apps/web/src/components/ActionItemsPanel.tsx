import type { VideoStatusResponse } from "../lib/api";
import { useSummaryData } from "./useSummaryData";

type ActionItemsPanelProps = {
  aiStatus: VideoStatusResponse["aiStatus"] | undefined;
  aiOutput: VideoStatusResponse["aiOutput"] | null | undefined;
  errorMessage: string | null | undefined;
};

export function ActionItemsPanel({
  aiStatus,
  aiOutput,
  errorMessage,
}: ActionItemsPanelProps) {
  const { copyFeedback, copyValue, actionItems } = useSummaryData({ aiOutput, chapters: [] });

  const actionItemsForCopy = actionItems
    .map((item, index) =>
      [
        `${index + 1}. ${item.task}`,
        item.assignee ? `Owner: ${item.assignee}` : null,
        item.deadline ? `When: ${item.deadline}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    )
    .join("\n");

  return (
    <div className="flex h-full flex-col">
      {(aiStatus === "queued" || aiStatus === "processing") && (
        <p className="px-4 pt-4 text-[13px] text-secondary">
          Action items will appear after the AI pass completes.
        </p>
      )}
      {aiStatus === "not_started" && (
        <p className="px-4 pt-4 text-[13px] text-secondary">
          Action items are generated from the finished transcript.
        </p>
      )}
      {aiStatus === "skipped" && (
        <p className="panel-subtle m-4 text-[13px]">
          Action items were skipped because transcript input was not available.
        </p>
      )}
      {aiStatus === "failed" && (
        <p className="panel-danger m-4 text-[13px]">
          {errorMessage ? `Action item extraction failed: ${errorMessage}` : "Action item extraction failed after retries."}
        </p>
      )}

      {aiStatus === "complete" && (
        <div className="space-y-4 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="workspace-label">Post-meeting follow-up</p>
              <h2 className="workspace-title">To-do list</h2>
              <p className="mt-1 text-[12px] text-secondary">
                A simple list of follow-up items pulled from the meeting summary.
              </p>
            </div>
            {actionItems.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  void copyValue(
                    actionItemsForCopy,
                    "Action items copied",
                    "Unable to copy action items."
                  )
                }
                className="btn-secondary shrink-0 px-2 py-1 text-[11px]"
              >
                Copy list
              </button>
            )}
          </div>

          {actionItems.length === 0 ? (
            <div className="rounded-lg border px-3 py-3 text-[13px] border-border-default">
              <p className="font-medium text-foreground">No action items were extracted.</p>
              <p className="mt-1 text-secondary">
                This stays intentionally simple. It only shows concrete follow-up items the AI could confidently pull from the meeting.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {actionItems.map((item, index) => (
                <li
                  key={`${item.task}-${index}`}
                  className="rounded-lg border px-3 py-2 border-border-default"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1 text-[12px] text-secondary">•</span>
                    <div className="min-w-0">
                      <p className="text-[13px] text-foreground">{item.task}</p>
                      {(item.assignee || item.deadline) && (
                        <p className="mt-1 text-[11px] text-muted">
                          {[
                            item.assignee ? `Owner: ${item.assignee}` : null,
                            item.deadline ? `Due: ${item.deadline}` : null,
                          ]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {copyFeedback && <p className="px-4 pb-2 text-[11px] font-medium text-muted">{copyFeedback}</p>}
    </div>
  );
}
