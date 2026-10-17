import { useState } from "react";
import { host } from "../host/client";
import { useComms } from "../comms";
import { runCode } from "../editor/files";

/** R help (Ark serves it on a loopback port) and htmlwidget/HTML output. */
export function HelpPanel() {
  const history = useComms((s) => s.helpHistory);
  const index = useComms((s) => s.helpIndex);
  const url = history[index];
  const [topic, setTopic] = useState("");

  const lookup = () => {
    const t = topic.trim();
    if (!t) return;
    // help() goes through Ark, which answers with show_help on the help comm.
    void runCode(`utils::help(${JSON.stringify(t)})`);
  };

  return (
    <div className="help">
      <div className="panel-toolbar">
        <button className="btn btn-small" disabled={index <= 0} onClick={() => useComms.setState({ helpIndex: index - 1 })} title="뒤로">
          ‹
        </button>
        <button
          className="btn btn-small"
          disabled={index >= history.length - 1}
          onClick={() => useComms.setState({ helpIndex: index + 1 })}
          title="앞으로"
        >
          ›
        </button>
        <input
          className="text-input"
          placeholder="도움말 검색 (예: lm)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookup()}
        />
        {url && (
          <button className="btn btn-small" onClick={() => host.call("shell.openExternal", { path: url })} title="브라우저에서 열기">
            ↗
          </button>
        )}
      </div>
      {url ? (
        <iframe className="help-frame" key={url} src={url} title="R 도움말" />
      ) : (
        <div className="empty">
          콘솔에서 <code>?함수이름</code>을 실행하거나 위에서 검색하세요.
        </div>
      )}
    </div>
  );
}
