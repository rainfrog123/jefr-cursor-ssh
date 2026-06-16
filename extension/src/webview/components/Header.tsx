/**
 * Top header: brand title, version tag, and a button to open the local
 * console. (The A- / % / A+ font controls are injected at runtime by an
 * appended script in the built bundle, not by this component.)
 */
import React from "react";

export function Header(props: {
  version: string;
  onOpenConsole: () => void;
}): JSX.Element {
  return (
    <div className="header">
      <h3>jefr</h3>
      <div className="header-right">
        {props.version && <span className="version-tag">v{props.version}</span>}
        <button className="btn-console" onClick={props.onOpenConsole}>
          Console
        </button>
      </div>
    </div>
  );
}
