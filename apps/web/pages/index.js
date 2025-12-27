const projects = [
  {
    name: "Example Project",
    description: "Replace this with a real project summary.",
    tags: ["example", "starter"],
    repo: "https://github.com/owner/repo"
  }
];

export default function Home() {
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">GitHub Projects</p>
        <h1>Projects + AI Chat</h1>
        <p className="lede">
          A curated homepage with an AI assistant that answers using GitHub as
          the source of truth.
        </p>
      </header>

      <section className="grid">
        {projects.map((project) => (
          <article className="card" key={project.name}>
            <h2>{project.name}</h2>
            <p>{project.description}</p>
            <div className="tags">
              {project.tags.map((tag) => (
                <span className="tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
            <a href={project.repo} target="_blank" rel="noreferrer">
              View on GitHub
            </a>
          </article>
        ))}
      </section>

      <section className="chat">
        <h2>Ask about these projects</h2>
        <div className="chat-box">
          <p className="muted">Chat UI coming next.</p>
        </div>
      </section>
    </main>
  );
}
