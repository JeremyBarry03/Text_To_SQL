import { useEffect, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const sampleQuestion = "Show the 15 most recent orders with customer names and totals.";

function App() {
  const [question, setQuestion] = useState("");
  const [rows, setRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [schema, setSchema] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [schemaError, setSchemaError] = useState("");

  useEffect(() => {
    fetchSchema();
  }, []);

  async function fetchSchema() {
    setSchemaError("");
    try {
      const res = await fetch(`${API_URL}/api/schema`);
      if (!res.ok) {
        throw new Error("Failed to load schema.");
      }
      const data = await res.json();
      setSchema(data.schema || "");
    } catch (err) {
      setSchemaError(err.message || "Unable to fetch schema.");
    }
  }

  async function handleAsk(e) {
    e.preventDefault();
    if (!question.trim()) {
      setError("Ask a question to get data.");
      return;
    }

    setLoading(true);
    setError("");
    setRows([]);
    setRowCount(0);

    try {
      const res = await fetch(`${API_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Request failed");
      }

      setRows(data.rows || []);
      setRowCount(data.rowCount || 0);
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const columns = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Text → data, powered by ChatGPT</p>
          <h1>Ask for data, get answers.</h1>
          <p className="lede">
            This UI sends your question to the API, lets ChatGPT generate a read-only SQL statement,
            runs it against Postgres, and returns just the results.
          </p>
        </div>
        <div className="badge-stack">
          <span className="badge">API: {API_URL}</span>
          <span className="badge quiet">JSON only, no writes.</span>
        </div>
      </header>

      <main className="grid">
        <section className="panel input-panel">
          <div className="panel-header">
            <h2>Ask a question</h2>
            <button type="button" className="ghost" onClick={() => setQuestion(sampleQuestion)}>
              Use sample
            </button>
          </div>
          <form onSubmit={handleAsk} className="question-form">
            <label className="label" htmlFor="question">
              Natural language question
            </label>
            <textarea
              id="question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. List total sales per region for the past 30 days"
              rows={4}
            />
            <div className="actions">
              <div className="muted small">
                The backend enforces read-only SQL and adds a LIMIT by default.
              </div>
              <button className="primary" type="submit" disabled={loading}>
                {loading ? "Running..." : "Get results"}
              </button>
            </div>
          </form>
          {error ? <div className="alert error">{error}</div> : null}
        </section>

        <section className="panel results-panel">
          <div className="panel-header">
            <h2>Results</h2>
            <div className="status-line">
              {rowCount ? `${rowCount} row(s)` : loading ? "Running..." : "No rows yet"}
            </div>
          </div>
          <div className="table-wrap">
            {rows.length ? (
              <table>
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx}>
                      {columns.map((col) => (
                        <td key={col}>
                          {row[col] === null || row[col] === undefined
                            ? "—"
                            : typeof row[col] === "object"
                            ? JSON.stringify(row[col])
                            : row[col].toString()}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">{loading ? "Waiting for results..." : "Run a query to see results."}</p>
            )}
          </div>
        </section>

        <section className="panel schema-panel">
          <div className="panel-header">
            <h2>Schema context</h2>
            <button type="button" className="ghost" onClick={fetchSchema}>
              Refresh
            </button>
          </div>
          {schemaError ? <div className="alert error">{schemaError}</div> : null}
          <pre className="schema-block">{schema || "Schema will load from the API."}</pre>
        </section>
      </main>
    </div>
  );
}

export default App;
