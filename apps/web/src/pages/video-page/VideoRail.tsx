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
        className="flex max-h-[520px] flex-col overflow-hidden rounded-xl border shadow-card"
        style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
      >
        <div className="rail-tab-bar">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelectTab(tab.key)}
              className={`rail-tab ${railTab === tab.key ? "rail-tab-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="rail-tab-stack scroll-panel">
          <div key={railTab} className="rail-tab-panel-enter">
            {renderRailTabContent(railTab)}
          </div>
        </div>
      </div>
    </div>
  );
}
