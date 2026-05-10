/* ============================================================
 * PAGE: LANDING / HOME
 * Keywords: landing, home, hero, marketing
 * ============================================================ */
import React, { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

// Marketing landing page with hero, features and audience sections.
export default function LandingPage() {
  const navigate = useNavigate()
  const auth = useAuth()

  useEffect(() => {
    // Clear frontend navigation caches when landing — keep the backend session intact
    // so that the 1-project guest limit stays enforced.
    window.sessionStorage.removeItem('simucast.fixTarget')
  }, [])

  useEffect(() => {
    if (auth.isAuthenticated) navigate('/dashboard', { replace: true })
  }, [auth.isAuthenticated, navigate])

  const launch = () => {
    if (auth.isAuthenticated) navigate('/dashboard')
    else auth.showAuthModal('login')
  }

  const openSignup = () => auth.showAuthModal('signup')

  const jumpTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="ax-landing">
      <nav className="ax-landing-nav">
        <div className="ax-landing-brand">
          <div className="ax-brand-mark">
            <img src="/simucast-logo.png" alt="SimuCast logo" />
          </div>
          <div>
            <strong>SimuCast</strong>
            <span>Predictive Analytics Platform</span>
          </div>
        </div>
        <div className="ax-landing-links">
          <a href="#features">Features</a>
          <a href="#workflow">Workflow</a>
          <a href="#audience">Designed For</a>
        </div>
        <div className="ax-landing-actions">
          {!auth.isAuthenticated && (
            <button className="ax-btn" onClick={() => auth.showAuthModal('login')} type="button">
              Log in
            </button>
          )}
          <button className="ax-btn prim" onClick={launch} type="button">
            Launch Platform -&gt;
          </button>
        </div>
      </nav>

      <section className="ax-landing-hero">
        <div className="ax-landing-copy">
          <p className="ax-landing-kicker">
            Predictive Modeling & What-if Analysis Platform
          </p>
          <h1>
            <span className="accent">Predictive</span>
            <span className="accent">Intelligence</span>
            <span>for Data-Driven Decisions</span>
          </h1>
          <p>
            Transform your data into strategic insights with machine learning,
            scenario analysis, and actionable recommendations, all without writing
            a single line of code.
          </p>
          <div className="ax-landing-cta">
            <button className="ax-btn prim" onClick={openSignup} type="button">
              Get Started -&gt;
            </button>
            <a className="ax-btn" href="/sample-dataset.csv" download="students-performance.csv">
              ↓ Sample Dataset
            </a>
          </div>
          <div className="ax-landing-stats">
            <Stat value="5+" label="ML Models" />
            <Stat value="What-if" label="Scenarios" />
            <Stat value="Dataset" label="Preparation & Expansion" />
            <Stat value="Report" label="Generations" />
          </div>
        </div>

        <div className="ax-hero-orbit" aria-label="SimuCast analytics preview">
          <div className="ax-float-card ax-float-metrics">
            <p><span /> Model Performance</p>
            <Metric label="Accuracy" value="85%" width="85%" />
            <Metric label="Precision" value="78%" width="78%" tone="purple" />
          </div>
          <div className="ax-float-card ax-float-insight">
            <p><Icon name="spark" /> AI Insight</p>
            <span>Records with high engagement metrics show 23% better outcomes.</span>
            <button type="button" onClick={() => jumpTo('features')}>View Details</button>
          </div>
          <div className="ax-float-card ax-float-score">
            <strong>+12%</strong>
            <span>Improvement</span>
          </div>
        </div>
      </section>

      <section id="workflow" className="ax-workflow-band">
        <h2>Simple 5-Step Workflow</h2>
        <p>From data upload to accountable insights in one guided workspace.</p>
        <div className="ax-workflow-steps">
          {[
            ['1', 'Upload Data', 'CSV or Excel sheets'],
            ['2', 'Prepare', 'Clean and standardize'],
            ['3', 'Describe and Test', 'Statistics and relationships'],
            ['4', 'Build Models', 'Compare task-based models'],
            ['5', 'Simulate', 'Run what-if scenarios'],
            ['6', 'Report', 'Insights and documentation'],
          ].map(([n, title, body], index) => (
            <React.Fragment key={title}>
              <div className="ax-workflow-step">
                <span>{n}</span>
                <strong>{title}</strong>
                <small>{body}</small>
              </div>
              {index < 5 && <b className="ax-workflow-arrow">-&gt;</b>}
            </React.Fragment>
          ))}
        </div>
      </section>

      <section id="features" className="ax-feature-section">
        <h2>Everything You Need</h2>
        <p>Current SimuCast tools for transparent, reproducible analytics.</p>
        <div className="ax-feature-grid">
          <FeatureCard
            wide
            tone="orange"
            icon="M4 6h16M4 12h16M4 18h10"
            title="Data Preparation Hub"
            body="Inspect the data grid, edit cells, apply grouped missing-value, outlier, duplicate, and category fixes, then export cleaned data."
            tags={['Grouped fixes', 'Category review', 'CSV export']}
          />
          <FeatureCard
            tone="blue"
            icon="M5 19V5l14 7-14 7z"
            title="Guided Project Plan"
            body="Switch between AI-if-available and system-only planning. Each step points to the exact section to use next."
            checks={['Specific section routing', 'Fallback transparency', 'Step tracking']}
          />
          <FeatureCard
            tone="soft"
            icon="M5 18l4-8 4 5 4-9 2 12"
            title="Analysis and Models"
            body="Run descriptive statistics, statistical analysis, strict regression/classification models, and inspect feature influence."
            stats={['MAE/RMSE/R2', 'Accuracy/F1/AUC', 'Train-test split']}
          />
          <FeatureCard
            icon="M6 7h12M6 12h12M6 17h8"
            title="Documentation and Reports"
            body="Every meaningful action is tracked for notes, undo where possible, and report-ready documentation."
          />
        </div>
      </section>

      <section id="audience" className="ax-audience-section">
        <h2>Designed For</h2>
        <p>Supporting teams that need data work to be explainable, repeatable, and easy to present.</p>
        <div className="ax-audience-grid">
          <Audience icon="cap" title="Academic Administrators" body="Make data-driven decisions on resource allocation, intervention programs, and student support strategies." checks={['Enrollment forecasting', 'Retention planning']} />
          <Audience icon="scope" title="Educational Researchers" body="Analyse patterns, test relationships, and publish findings with comprehensive analytical tools." checks={['Pattern discovery', 'Statistical analysis']} />
          <Audience icon="chart" title="Data Analysts" body="Streamline workflows with automated modeling, scenario testing, and report generation capabilities." checks={['Automated workflows', 'Quick reporting']} />
        </div>
      </section>

      <section className="ax-final-cta">
        <h2>Ready to Transform Your Analytics?</h2>
        <p>Start with a temporary guest demo, then sign up when you want saved projects and AI features.</p>
        <button className="ax-btn" onClick={openSignup} type="button">
          Try SimuCast Now -&gt;
        </button>
      </section>

      <footer className="ax-landing-footer">
        <div>
          <span className="ax-footer-logo"><img src="/simucast-logo.png" alt="SimuCast logo" /></span>
          <strong>SimuCast Platform</strong>
        </div>
        <p>2026 SimuCast Platform</p>
      </footer>
    </main>
  )
}

// Renders a small stat block with a bold value and a description label.
function Stat({ value, label }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

// Hero metric row with a label, an animated bar width and a value.
function Metric({ label, value, width, tone }) {
  return (
    <div className="ax-hero-metric">
      <label>{label}</label>
      <div><i className={tone || ''} style={{ width }} /></div>
      <strong>{value}</strong>
    </div>
  )
}

// Renders a single benefit item with an icon, title and short body copy.
function Benefit({ icon, title, body }) {
  return (
    <div>
      <span><Icon name={icon} /></span>
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  )
}

// Marketing feature card with icon, title, body and optional tags, checks and stats.
function FeatureCard({ wide, tone, icon, title, body, tags, checks, stats }) {
  return (
    <article className={`ax-feature-card ${wide ? 'wide' : ''} ${tone || ''}`}>
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
        <path d={icon} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <h3>{title}</h3>
      <p>{body}</p>
      {tags && (
        <div className="ax-feature-tags">
          {tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}
      {checks && (
        <ul>
          {checks.map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {stats && (
        <div className="ax-feature-stats">
          {stats.map((item, idx) => <span key={item} className={idx === 1 ? 'dark' : ''}>{item}</span>)}
        </div>
      )}
    </article>
  )
}

// Card describing a target audience with icon, title, body and bullet checks.
function Audience({ icon, title, body, checks }) {
  return (
    <article className="ax-audience-card">
      <span className="ax-audience-icon"><Icon name={icon} /></span>
      <h3>{title}</h3>
      <p>{body}</p>
      <ul>
        {checks.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </article>
  )
}

// Renders a named SVG icon used by the landing page benefit and audience blocks.
function Icon({ name }) {
  const icons = {
    settings: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.5 4a7.8 7.8 0 00-.1-1l2-1.5-2-3.5-2.4 1a8 8 0 00-1.7-1L16 3h-4l-.3 3a8 8 0 00-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 000 2l-2 1.5 2 3.5 2.4-1a8 8 0 001.7 1l.3 3h4l.3-3a8 8 0 001.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z',
    hand: 'M7 11V7a2 2 0 114 0v4M11 10V5a2 2 0 114 0v7M15 11V7a2 2 0 114 0v8c0 4-3 6-7 6h-1c-3 0-5-2-6-5l-1-3a2 2 0 013.8-1.2L9 15',
    bulb: 'M9 18h6M10 22h4M8 14a6 6 0 118 0c-1 1-1.5 2-1.5 3h-5C9.5 16 9 15 8 14z',
    cap: 'M3 8l9-4 9 4-9 4-9-4zm4 3v4c2 2 8 2 10 0v-4M19 9v5',
    scope: 'M10 14l-4 6M14 14l4 6M8 20h8M12 14a4 4 0 100-8 4 4 0 000 8zM12 2v2',
    chart: 'M5 19V9M12 19V5M19 19v-7M4 19h16',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  }
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={icons[name] || icons.chart} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
