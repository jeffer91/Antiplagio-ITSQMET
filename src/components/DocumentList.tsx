import type { DocumentListItem, ExtractionStatus } from '../types/documents';

interface Props {
  documents: DocumentListItem[];
  showOwner?: boolean;
  onView: (document: DocumentListItem) => void;
  onNewVersion?: (document: DocumentListItem) => void;
}

const labels: Record<ExtractionStatus, string> = {
  ready: 'Listo',
  needs_ocr: 'Requiere OCR',
  failed: 'Con error',
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function DocumentList({ documents, showOwner = false, onView, onNewVersion }: Props): React.JSX.Element {
  return (
    <section className="document-table-wrap">
      <div className="document-table-heading">
        <div><span className="eyebrow dark">Documentos</span><h2>{showOwner ? 'Entregas registradas' : 'Mis trabajos'}</h2></div>
        <span>{documents.length} {documents.length === 1 ? 'trabajo' : 'trabajos'}</span>
      </div>
      <div className="document-table-scroll">
        <table className="document-table">
          <thead><tr><th>Trabajo</th>{showOwner && <th>Estudiante / usuario</th>}<th>Versión</th><th>Extracción</th><th>Actualizado</th><th /></tr></thead>
          <tbody>
            {documents.map((document) => (
              <tr key={document.id}>
                <td><strong>{document.title}</strong><small>{document.latest_version?.original_file_name ?? 'Sin archivo'}</small></td>
                {showOwner && <td><strong>{document.owner_name}</strong><small>{document.owner_email}</small></td>}
                <td><span className="version-pill">V{document.current_version}</span></td>
                <td><span className={`document-status ${document.status}`}>{labels[document.status]}</span></td>
                <td>{formatDate(document.updated_at)}</td>
                <td className="row-actions"><button className="table-button" type="button" onClick={() => onView(document)}>Ver</button>{onNewVersion && <button className="table-button accent" type="button" onClick={() => onNewVersion(document)}>+ Versión</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
