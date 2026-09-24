import './BuildVersionBadge.css';

const version = import.meta.env.VITE_APP_VERSION || 'PG-dev';
const commit = import.meta.env.VITE_APP_COMMIT || 'local';
const shortCommit = commit === 'local' ? commit : commit.slice(0, 7);

export function BuildVersionBadge(): React.JSX.Element {
  return (
    <div
      className="build-version-badge"
      title={`PlagGuard ${version} · commit ${commit}`}
      aria-label={`Versión de PlagGuard ${version}, commit ${shortCommit}`}
    >
      <span>{version}</span>
      <strong>{shortCommit}</strong>
    </div>
  );
}
