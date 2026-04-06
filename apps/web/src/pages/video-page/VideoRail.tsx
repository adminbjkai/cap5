import type { ReactNode } from "react";
import type { RailTab } from "./shared";

type VideoRailProps = {
  railTab: RailTab;
  onSelectTab: (tab: RailTab) => void;
  renderRailTabContent: (tab: RailTab) => ReactNode;
};

const TABS: Array<{ key: RailTab; label: string }> = [
  { key: "notes", label: "Notes" },
  { key: "summary", label: "Summary" },
  { key: "actions", label: "Actions" },
  { key: "transcript", label: "Transcript" },
];

export function VideoRail({
  railTab,
  onSelectTab,
  renderRailTabContent,
}: VideoRailProps) {
  return (
    <div className="min-w-0">
      <div
        className="flex max-h-[520px] min-h-[320px] flex-col overflow-hidden rounded-xl border shadow-card"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
      >
        <div className="rail-tab-bar" role="tablist" aria-label="Video details panels">
          {TABS.map((tab) => {
            const isActive = railTab === tab.key;
            const tabId = `video-rail-tab-${tab.key}`;
            const panelId = `video-rail-panel-${tab.key}`;

            return (
              <button
                key={tab.key}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onSelectTab(tab.key)}
                className={`rail-tab ${isActive ? "rail-tab-active" : ""}`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="rail-tab-stack">
          <section
            key={railTab}
            id={`video-rail-panel-${railTab}`}
            role="tabpanel"
            aria-labelledby={`video-rail-tab-${railTab}`}
            className="rail-tab-panel"
          >
            {renderRailTabContent(railTab)}
          </section>
        </div>
      </div>
    </div>
  );
}
