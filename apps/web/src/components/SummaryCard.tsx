import type { VideoStatusResponse } from '../lib/api';
import { useSummaryData } from './useSummaryData';

type SummaryCardProps = {
  aiStatus: VideoStatusResponse['aiStatus'] | undefined;
  aiOutput: VideoStatusResponse['aiOutput'] | null | undefined;
  errorMessage: string | null | undefined;
  shareableResultUrl: string | null;
  chapters: Array<{ title: string; seconds: number }>;
  onJumpToSeconds: (seconds: number) => void;
};

export function SummaryCard({
  aiStatus,
  aiOutput,
  errorMessage,
  shareableResultUrl: _shareableResultUrl,
  chapters,
  onJumpToSeconds,
}: SummaryCardProps) {
  const {
    copyFeedback,
    summaryForCopy,
    copyValue,
    chapterItems,
    entitySections,
    actionItems,
    quotes,
    formatTimestamp,
  } = useSummaryData({ aiOutput, chapters });

  const Inner = (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="workspace-label">Summary</p>
          <h2 className="workspace-title">Summary and Chapters</h2>
        </div>
        <span className="status-chip">{aiStatus ?? 'not_started'}</span>
      </div>

      {(aiStatus === 'queued' || aiStatus === 'processing') && (
        <p className="text-sm text-hint">Summary generation is in progress.</p>
      )}
      {aiStatus === 'not_started' && (
        <p className="text-sm text-hint">Summary generation starts after transcript completion.</p>
      )}
      {aiStatus === 'skipped' && (
        <p className="panel-subtle">
          Summary was skipped because transcript input was not available.
        </p>
      )}
      {aiStatus === 'failed' && (
        <p className="panel-danger">
          {errorMessage ? `Summary failed: ${errorMessage}` : 'Summary failed after retries.'}
        </p>
      )}
      {aiStatus === 'complete' && !aiOutput?.summary && !aiOutput?.title && (
        <p className="panel-subtle">Summary completed, but no content was returned.</p>
      )}

      {aiStatus === 'complete' && aiOutput && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {summaryForCopy && (
              <button
                type="button"
                onClick={() =>
                  void copyValue(summaryForCopy, 'Summary copied', 'Unable to copy summary.')
                }
                className="btn-secondary text-xs px-2.5 py-1"
              >
                Copy summary
              </button>
            )}
          </div>
          {aiOutput.title && <h3 className="text-xl font-semibold">{aiOutput.title}</h3>}
          {aiOutput.summary && (
            <p className="panel-subtle rounded-lg px-4 py-3 text-sm leading-relaxed">
              {aiOutput.summary}
            </p>
          )}
          {chapterItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-muted">
                Chapters
              </p>
              <ol className="space-y-1">
                {chapterItems.map((chapter, index) => (
                  <li key={`${chapter.title}-${index}-${chapter.jumpSeconds ?? 'na'}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (chapter.jumpSeconds !== null) onJumpToSeconds(chapter.jumpSeconds);
                      }}
                      disabled={chapter.jumpSeconds === null}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-muted disabled:opacity-60"
                    >
                      <span className="font-mono text-xs w-12 shrink-0 text-muted">
                        {chapter.jumpSeconds !== null
                          ? formatTimestamp(chapter.jumpSeconds)
                          : '--:--'}
                      </span>
                      <span className="flex-1 text-sm leading-snug">{chapter.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          {entitySections.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-muted">
                Entities
              </p>
              {entitySections.map((section) => (
                <div key={section.label}>
                  <p className="text-xs font-medium text-secondary">{section.label}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {section.items.map((item) => (
                      <span
                        key={`${section.label}-${item}`}
                        className="rounded-full border px-2 py-0.5 text-xs"
                        style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {actionItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-muted">
                Action items
              </p>
              <ul className="space-y-2">
                {actionItems.map((item, index) => (
                  <li
                    key={`${item.task}-${index}`}
                    className="rounded-lg border px-3 py-2 text-sm border-border-default"
                  >
                    <p>{item.task}</p>
                    {(item.assignee || item.deadline) && (
                      <p className="mt-1 text-xs text-muted">
                        {[
                          item.assignee ? `Assignee: ${item.assignee}` : null,
                          item.deadline ? `Due: ${item.deadline}` : null,
                        ]
                          .filter(Boolean)
                          .join(' • ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {quotes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2 text-muted">
                Quotes
              </p>
              <ul className="space-y-2">
                {quotes.map((quote, index) => (
                  <li
                    key={`${quote.text}-${index}`}
                    className="rounded-lg border px-3 py-2 text-sm border-border-default"
                  >
                    <p>&ldquo;{quote.text}&rdquo;</p>
                    <button
                      type="button"
                      onClick={() => onJumpToSeconds(quote.timestamp)}
                      className="mt-1 text-xs font-medium text-blue"
                    >
                      Jump to {formatTimestamp(quote.timestamp)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {copyFeedback && (
        <p className="mt-3 text-xs font-medium text-muted">{copyFeedback}</p>
      )}
    </div>
  );

  return <section className="workspace-card">{Inner}</section>;
}
