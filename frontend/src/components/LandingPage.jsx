import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'

export default function LandingPage() {
  const navigate = useNavigate()
  const auth = useAuth()

  const startGuest = async () => {
    await auth.ensureGuest()
    navigate('/dashboard')
  }

  return (
    <main className="ax-landing">
      <nav className="ax-landing-nav">
        <div className="ax-landing-brand">
          <div className="ax-brand-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M5 19V7M10 19V4M15 19v-8M20 19v-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M4 19h17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <strong>SimuCast</strong>
            <span>Predictive Analytics</span>
          </div>
        </div>
        <div className="ax-landing-actions">
          {auth.isAuthenticated ? (
            <button className="ax-btn" onClick={() => navigate('/dashboard')} type="button">
              Open app
            </button>
          ) : (
            <>
              <button className="ax-btn" onClick={() => auth.showAuthModal('login')} type="button">
                Log in
              </button>
              <button className="ax-btn prim" onClick={() => auth.showAuthModal('signup')} type="button">
                Sign up
              </button>
            </>
          )}
        </div>
      </nav>

      <section className="ax-landing-hero">
        <div className="ax-landing-copy">
          <p className="ax-landing-kicker">Data preparation to report, in one guided flow</p>
          <h1>Clean, analyze, model, and explain your dataset.</h1>
          <p>
            SimuCast helps you move from raw data to documented predictive insights with cleaning,
            tests, models, what-if scenarios, and report-ready activity logs in one workspace.
          </p>
          <div className="ax-landing-cta">
            <button className="ax-btn prim" onClick={startGuest} type="button">
              Continue as guest
            </button>
            <button className="ax-btn" onClick={() => navigate('/projects')} type="button">
              View projects
            </button>
          </div>
          <p className="ax-landing-note">
            Guest mode includes one model-training run. Sign up to keep working without the guest limit.
          </p>
        </div>

        <div className="ax-landing-preview" aria-label="SimuCast workflow preview">
          <div className="ax-preview-top">
            <span />
            <span />
            <span />
          </div>
          <div className="ax-preview-body">
            <div className="ax-preview-card active">
              <small>Data Prep</small>
              <strong>Missing values handled</strong>
              <p>3 columns cleaned, 18 values filled</p>
            </div>
            <div className="ax-preview-card">
              <small>Models</small>
              <strong>Random Forest trained</strong>
              <p>Accuracy 82.4%, AUC 0.955</p>
            </div>
            <div className="ax-preview-grid">
              <div>
                <span>Documentation</span>
                <strong>26</strong>
              </div>
              <div>
                <span>Scenarios</span>
                <strong>4</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="ax-landing-steps">
        {[
          ['1', 'Prepare data', 'Upload sheets, clean grouped issues, standardize categories, and track every meaningful step.'],
          ['2', 'Build evidence', 'Run descriptive insights, statistical tests, and strict task-based model training.'],
          ['3', 'Simulate outcomes', 'Use saved models for what-if scenarios with dataset-bound risk warnings.'],
          ['4', 'Export the story', 'Generate a structured report with documentation, metrics, scenarios, and notes.'],
        ].map(([n, title, body]) => (
          <article className="ax-card ax-landing-step" key={title}>
            <span>{n}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
