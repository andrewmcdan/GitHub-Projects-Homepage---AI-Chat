import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";
const CHAT_HISTORY_LIMIT = 8;
const VISITOR_ID_KEY = "gh-projects-visitor-id";

const extractRepoFromUrl = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(
    /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#]|$)/i
  );
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
};

const normalizeLoose = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");
const tokenize = (value) =>
  value.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean);

const repoIntentTokens = new Set([
  "project",
  "repo",
  "repository",
  "codebase",
  "app",
  "service",
  "library"
]);

const hasProjectIntent = (question) => {
  if (typeof question !== "string") {
    return false;
  }
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith("what is ") ||
    normalized.startsWith("tell me about ") ||
    normalized.startsWith("describe ") ||
    normalized.startsWith("explain ") ||
    normalized.startsWith("summarize ") ||
    normalized.startsWith("overview of ")
  ) {
    return true;
  }
  const tokens = tokenize(question);
  return tokens.some((token) => repoIntentTokens.has(token));
};

const hasTokenSequence = (tokens, phraseTokens, minTokens) => {
  if (!Array.isArray(tokens) || !Array.isArray(phraseTokens)) {
    return false;
  }
  if (tokens.length === 0 || phraseTokens.length === 0) {
    return false;
  }
  const minLen = Math.min(
    phraseTokens.length,
    Math.max(minTokens || phraseTokens.length, 1)
  );
  const haystack = ` ${tokens.join(" ")} `;
  for (let len = phraseTokens.length; len >= minLen; len -= 1) {
    for (let start = 0; start <= phraseTokens.length - len; start += 1) {
      const needle = ` ${phraseTokens.slice(start, start + len).join(" ")} `;
      if (haystack.includes(needle)) {
        return true;
      }
    }
  }
  return false;
};

const isExplicitTokenMatch = (questionTokens, phraseTokens, hasIntent) => {
  if (!Array.isArray(phraseTokens) || phraseTokens.length === 0) {
    return false;
  }
  const minTokens = phraseTokens.length >= 2 ? 2 : 1;
  if (!hasTokenSequence(questionTokens, phraseTokens, minTokens)) {
    return false;
  }
  if (phraseTokens.length === 1) {
    const token = phraseTokens[0];
    if (token.length < 5 && !hasIntent) {
      return false;
    }
  }
  return true;
};

const getProjectRepo = (project) => {
  if (!project || typeof project !== "object") {
    return null;
  }

  const repoValue =
    typeof project.repo === "string" ? project.repo.trim() : "";
  if (repoValue) {
    const repoFromUrl = extractRepoFromUrl(repoValue);
    if (repoFromUrl) {
      return repoFromUrl;
    }
    if (repoValue.includes("/") && !repoValue.includes("http")) {
      return repoValue;
    }
  }

  const nameValue =
    typeof project.name === "string" ? project.name.trim() : "";
  if (nameValue && nameValue.includes("/") && !nameValue.includes(" ")) {
    return nameValue;
  }

  return null;
};

const resolveRepoFromQuestion = (question, projects) => {
  if (typeof question !== "string") {
    return null;
  }

  const urlRepo = extractRepoFromUrl(question);
  if (urlRepo) {
    return { repo: urlRepo, explicit: true };
  }

  const normalizedQuestion = question.toLowerCase();
  const looseQuestion = normalizeLoose(question);
  const questionTokens = tokenize(question);
  const questionTokenSet = new Set(questionTokens);
  const questionHasIntent = hasProjectIntent(question);
  const candidates = [];

  for (const project of projects || []) {
    const repoId = getProjectRepo(project);
    if (!repoId) {
      continue;
    }

    const repoLower = repoId.toLowerCase();
    if (normalizedQuestion.includes(repoLower)) {
      candidates.push({ repo: repoId, score: 3, explicit: true });
      continue;
    }

    const nameValue =
      typeof project.name === "string" ? project.name.trim() : "";
    const nameLoose = normalizeLoose(nameValue);
    const nameTokens = tokenize(nameValue);
    const explicitNameMatch = isExplicitTokenMatch(
      questionTokens,
      nameTokens,
      questionHasIntent
    );
    if (nameLoose && looseQuestion.includes(nameLoose)) {
      candidates.push({ repo: repoId, score: 2, explicit: explicitNameMatch });
      continue;
    }

    const repoName = repoId.split("/")[1] || "";
    const repoLoose = normalizeLoose(repoName);
    const repoTokens = tokenize(repoName);
    const explicitRepoMatch = isExplicitTokenMatch(
      questionTokens,
      repoTokens,
      questionHasIntent
    );
    if (repoLoose && looseQuestion.includes(repoLoose)) {
      candidates.push({ repo: repoId, score: 1, explicit: explicitRepoMatch });
      continue;
    }

    const tokenMatches = [
      ...new Set([...tokenize(nameValue), ...tokenize(repoId)])
    ].filter((token) => token.length >= 4 && questionTokenSet.has(token));
    if (tokenMatches.length > 0) {
      candidates.push({ repo: repoId, score: 0, explicit: false });
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.score - a.score);
  const topScore = candidates[0].score;
  const topRepos = [
    ...new Map(
      candidates
        .filter((item) => item.score === topScore)
        .map((item) => [item.repo, item])
    ).values()
  ];

  return topRepos.length === 1 ? topRepos[0] : null;
};

const buildHistoryPayload = (messages) => {
  if (!Array.isArray(messages)) {
    return [];
  }

  const trimmed = messages
    .filter((message) => message && typeof message.content === "string")
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
      citations:
        message.role === "assistant" && Array.isArray(message.citations)
          ? message.citations
          : undefined
    }))
    .filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.content
    );

  if (trimmed.length <= CHAT_HISTORY_LIMIT) {
    return trimmed;
  }

  return trimmed.slice(-CHAT_HISTORY_LIMIT);
};

const inferRepoFromCitations = (citations) => {
  if (!Array.isArray(citations) || citations.length === 0) {
    return null;
  }

  const counts = new Map();
  for (const citation of citations) {
    const repo =
      citation && typeof citation.repo === "string" ? citation.repo.trim() : "";
    if (!repo) {
      continue;
    }
    counts.set(repo, (counts.get(repo) || 0) + 1);
  }

  if (counts.size === 0) {
    return null;
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
};

const formatSessionLabel = (session) => {
  const raw =
    (session && typeof session.lastMessage === "string"
      ? session.lastMessage
      : "") || "New chat";
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length <= 60) {
    return trimmed;
  }
  return `${trimmed.slice(0, 57)}...`;
};

const formatSessionTime = (value) => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

export default function Home() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedProjectId, setExpandedProjectId] = useState(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatError, setChatError] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeRepo, setActiveRepo] = useState(null);
  const [visitorId, setVisitorId] = useState("");
  const [chatSessions, setChatSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const abortRef = useRef(null);
  const chatStreamRef = useRef(null);
  const latestMessageRef = useRef(null);

  const loadProjects = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/projects`);
      if (!response.ok) {
        throw new Error("Failed to load projects");
      }
      const data = await response.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err) {
      setError(err.message || "Failed to load projects");
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    if (!visitorId) {
      return;
    }
    setSessionsLoading(true);
    setSessionsError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/chat/sessions?visitorId=${encodeURIComponent(
          visitorId
        )}`
      );
      if (!response.ok) {
        throw new Error("Failed to load sessions");
      }
      const data = await response.json();
      setChatSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (err) {
      setSessionsError(err.message || "Failed to load sessions");
    } finally {
      setSessionsLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem(VISITOR_ID_KEY);
    const id = stored || crypto.randomUUID();
    if (!stored) {
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    setVisitorId(id);
  }, []);

  useEffect(() => {
    if (visitorId) {
      loadSessions();
    }
  }, [visitorId]);

  useEffect(() => {
    const container = chatStreamRef.current;
    const target = latestMessageRef.current;
    if (!container || !target) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offset = targetRect.top - containerRect.top;
    if (Math.abs(offset) > 1) {
      container.scrollTop += offset;
    }
  }, [chatMessages]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAdding(true);
    setMessage("");
    try {
      const response = await fetch(`${API_BASE_URL}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Failed to add project");
      }
      setMessage(
        payload.status === "exists"
          ? "Project already listed."
          : "Project added."
      );
      setRepoUrl("");
      await loadProjects();
    } catch (err) {
      setMessage(err.message || "Failed to add project");
    } finally {
      setAdding(false);
    }
  };

  const toggleProject = (projectId) => {
    setExpandedProjectId((current) =>
      current === projectId ? null : projectId
    );
  };

  const stopStreaming = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  const openAbout = () => {
    setIsAboutOpen(true);
  };

  const closeAbout = () => {
    setIsAboutOpen(false);
  };

  const loadSessionMessages = async (sessionId) => {
    if (!visitorId || !sessionId) {
      return;
    }
    setMessagesLoading(true);
    setChatError("");
    try {
      const response = await fetch(
        `${API_BASE_URL}/chat/sessions/${sessionId}/messages?visitorId=${encodeURIComponent(
          visitorId
        )}&limit=200`
      );
      if (!response.ok) {
        throw new Error("Failed to load messages");
      }
      const data = await response.json();
      const messages = Array.isArray(data.messages) ? data.messages : [];
      const mapped = messages.map((msg) => ({
        id: `session-${msg.id}`,
        role: msg.role,
        content: msg.content,
        citations: Array.isArray(msg.citations) ? msg.citations : []
      }));
      setChatMessages(mapped);
      const lastAssistant = [...mapped]
        .reverse()
        .find(
          (msg) =>
            msg.role === "assistant" &&
            Array.isArray(msg.citations) &&
            msg.citations.length > 0
        );
      if (lastAssistant) {
        setActiveRepo(inferRepoFromCitations(lastAssistant.citations));
      } else {
        setActiveRepo(null);
      }
    } catch (err) {
      setChatError(err.message || "Failed to load messages");
    } finally {
      setMessagesLoading(false);
    }
  };

  const startNewChat = () => {
    stopStreaming();
    setActiveSessionId(null);
    setChatMessages([]);
    setChatError("");
    setActiveRepo(null);
  };

  const handleSelectSession = async (sessionId) => {
    if (!sessionId || sessionId === activeSessionId) {
      return;
    }
    stopStreaming();
    setActiveSessionId(sessionId);
    setChatMessages([]);
    await loadSessionMessages(sessionId);
  };

  const submitChat = async () => {
    if (!chatInput.trim() || isStreaming) {
      return;
    }

    const question = chatInput.trim();
    const history = buildHistoryPayload(chatMessages);
    const repoMatch = resolveRepoFromQuestion(question, projects);
    const explicitRepo = repoMatch?.explicit ? repoMatch.repo : null;
    const repo = explicitRepo || activeRepo || repoMatch?.repo || null;
    const shouldResetHistory = explicitRepo && explicitRepo !== activeRepo;
    const historyPayload = shouldResetHistory ? [] : history;
    setChatInput("");
    setChatError("");
    if (explicitRepo) {
      setActiveRepo(explicitRepo);
    } else if (!activeRepo && repoMatch?.repo) {
      setActiveRepo(repoMatch.repo);
    }

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question
    };
    const assistantId = crypto.randomUUID();
    const assistantMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      citations: []
    };

    setChatMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const updateAssistant = (updateFn) => {
      setChatMessages((prev) =>
        prev.map((msg) => (msg.id === assistantId ? updateFn(msg) : msg))
      );
    };

    try {
      const payload = { question, stream: true, history: historyPayload };
      if (visitorId) {
        payload.visitorId = visitorId;
      }
      if (repo) {
        payload.repo = repo;
      }
      if (activeSessionId) {
        payload.sessionId = activeSessionId;
      }

      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Chat failed");
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const lines = part.split("\n").filter(Boolean);
          if (lines.length === 0) {
            continue;
          }
          let eventType = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              data += line.slice(5).trim();
            }
          }
          if (!data) {
            continue;
          }

          let payload;
          try {
            payload = JSON.parse(data);
          } catch {
            continue;
          }

          if (eventType === "meta") {
            updateAssistant((msg) => ({
              ...msg,
              citations: payload.citations || []
            }));
            if (payload.sessionId) {
              setActiveSessionId(payload.sessionId);
            }
            const inferredRepo = inferRepoFromCitations(payload.citations);
            if (inferredRepo) {
              setActiveRepo(inferredRepo);
            }
          } else if (eventType === "delta") {
            updateAssistant((msg) => ({
              ...msg,
              content: msg.content + (payload.delta || "")
            }));
          } else if (eventType === "done") {
            loadSessions();
          } else if (eventType === "error") {
            throw new Error(payload.error || "Chat failed");
          }
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setChatError(err.message || "Chat failed");
      }
    } finally {
      setIsStreaming(false);
    }
  };

  const handleChatSubmit = (event) => {
    event.preventDefault();
    submitChat();
  };

  const handleChatKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitChat();
    }
  };

  return (
    <main className="layout">
      <aside className="panel sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">Projects</p>
          <h2>Project catalog</h2>
          <p className="muted">
            Paste a GitHub repo URL to add it. Details are pulled from GitHub.
          </p>
        </div>

        <div className="project-list">
          {loading ? (
            <p className="muted">Loading projects...</p>
          ) : error ? (
            <p className="status error">{error}</p>
          ) : projects.length === 0 ? (
            <p className="muted">No projects yet. Add your first repo below.</p>
          ) : (
            projects.map((project) => {
              const projectId = project.id || project.repo;
              const isExpanded = projectId === expandedProjectId;
              const fallbackName =
                typeof project.repo === "string" &&
                project.repo.startsWith("https://github.com/")
                  ? project.repo.replace("https://github.com/", "")
                  : projectId;
              const displayName =
                typeof project.name === "string" && project.name.includes("/")
                  ? project.name
                  : fallbackName;
              return (
                <div className="project-item" key={projectId}>
                  <button
                    type="button"
                    className="project-button"
                    onClick={() => toggleProject(projectId)}
                    aria-expanded={isExpanded}
                  >
                    <span className="project-name">{displayName}</span>
                  </button>
                  {isExpanded ? (
                    <div className="project-details">
                      <p>
                        {project.description || "No description yet."}
                      </p>
                      {project.repo ? (
                        <a href={project.repo} target="_blank" rel="noreferrer">
                          View on GitHub
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <form className="form add-project" onSubmit={handleSubmit}>
          <label className="field">
            <span>GitHub repo URL</span>
            <input
              type="url"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              required
            />
          </label>
          <button type="submit" className="primary-button" disabled={adding}>
            {adding ? "Adding..." : "Add project"}
          </button>
          {message ? <p className="status">{message}</p> : null}
        </form>
      </aside>

      <section className="main">
        <header className="hero">
          <p className="eyebrow">GitHub Projects</p>
          <div className="hero-title">
            <h1>Projects + AI Chat</h1>
            <button
              type="button"
              className="ghost-button about-button"
              onClick={openAbout}
            >
              About
            </button>
          </div>
          <p className="lede">
            A curated homepage with an AI assistant that answers using GitHub as
            the source of truth.
          </p>
        </header>

        <section className="chat-window">
          <div className="chat-header">
            <h2>Ask about these projects</h2>
            {isStreaming ? (
              <button
                type="button"
                className="ghost-button"
                onClick={stopStreaming}
              >
                Stop
              </button>
            ) : null}
          </div>
          <div className="chat-stream" ref={chatStreamRef}>
            {messagesLoading ? (
              <p className="muted">Loading messages...</p>
            ) : chatMessages.length === 0 ? (
              <p className="muted">
                Ask a question about the indexed repos to get started.
              </p>
            ) : (
              chatMessages.map((msg, index) => (
                <div
                  key={msg.id}
                  className={`chat-message ${msg.role}`}
                  ref={
                    index === chatMessages.length - 1
                      ? latestMessageRef
                      : null
                  }
                >
                  <div className="chat-bubble">
                    {msg.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === "assistant" &&
                  Array.isArray(msg.citations) &&
                  msg.citations.length > 0 ? (
                    <details className="citation-disclosure">
                      <summary>Sources ({msg.citations.length})</summary>
                      <div className="citation-list">
                        {msg.citations.map((citation) => {
                          const label = `${citation.repo || "source"}${
                            citation.path ? `/${citation.path}` : ""
                          }`;
                          const href = citation.url || null;
                          return href ? (
                            <a
                              className="citation-item"
                              key={`${msg.id}-${citation.index}`}
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              [{citation.index}] {label}
                            </a>
                          ) : (
                            <span
                              className="citation-item"
                              key={`${msg.id}-${citation.index}`}
                            >
                              [{citation.index}] {label}
                            </span>
                          );
                        })}
                      </div>
                    </details>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <form className="chat-input" onSubmit={handleChatSubmit}>
            <textarea
              rows={3}
              placeholder="Ask about architecture, code, or design decisions..."
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              onKeyDown={handleChatKeyDown}
              required
            />
            <div className="chat-actions">
              {chatError ? <span className="status error">{chatError}</span> : null}
              <button type="submit" className="primary-button" disabled={isStreaming}>
                {isStreaming ? "Streaming..." : "Send"}
              </button>
            </div>
          </form>
        </section>
      </section>

      <aside className="panel sidebar">
        <div className="sidebar-header">
          <p className="eyebrow">Chats</p>
          <div className="sidebar-row">
            <h2>Recent chats</h2>
            <button
              type="button"
              className="ghost-button new-chat-button"
              onClick={startNewChat}
            >
              New
            </button>
          </div>
        </div>
        <div className="chat-list">
          {sessionsLoading ? (
            <p className="muted">Loading chats...</p>
          ) : sessionsError ? (
            <p className="status error">{sessionsError}</p>
          ) : chatSessions.length === 0 ? (
            <p className="muted">No chats yet.</p>
          ) : (
            chatSessions.map((session) => {
              const label = formatSessionLabel(session);
              const timestamp = formatSessionTime(
                session.lastMessageAt || session.createdAt
              );
              const isActive = session.id === activeSessionId;
              return (
                <button
                  key={session.id}
                  type="button"
                  className={`chat-session${isActive ? " active" : ""}`}
                  onClick={() => handleSelectSession(session.id)}
                >
                  <span className="chat-session-title">{label}</span>
                  {timestamp ? (
                    <span className="chat-session-meta">{timestamp}</span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </aside>

      {isAboutOpen ? (
        <div
          className="about-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-title"
        >
          <div className="about-card">
            <div className="about-header">
              <h2 id="about-title">About</h2>
              <button
                type="button"
                className="ghost-button"
                onClick={closeAbout}
              >
                Close
              </button>
            </div>
            <div className="about-body">
              <p>
                This is my GitHub projects hub and AI workspace. It curates the
                repos I care about and lets me ask questions using the repo code
                as the source of truth.
              </p>
              <p>
                Use the project catalog on the left to add repos, and the chat
                in the middle to explore architecture, code, and design
                decisions across my work.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="about-backdrop"
            aria-label="Close About"
            onClick={closeAbout}
          />
        </div>
      ) : null}
    </main>
  );
}
