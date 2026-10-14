import { useEffect, useRef, useState } from 'react';
import { acceptInvite, AuthError, DEMO, LOCK_MINUTES, lookupInvite, requestReset, signIn } from '../auth/mockAuth';
import { cleanEmail, emailError, MAX_EMAIL, MAX_PASSWORD, passwordChecks, validateNewPassword, validateSignIn } from '../auth/validate';
import Icon from './Icons';

const timeOf = (ms) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function PasswordField({ id, label, value, onChange, onBlur, error, autoComplete, describedBy, inputRef, children }) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const onKey = (e) => setCaps(!!(e.getModifierState && e.getModifierState('CapsLock')));
  const ids = [describedBy, caps && `${id}-caps`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="pw">
        <input
          ref={inputRef}
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          maxLength={MAX_PASSWORD + 1}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={onKey}
          onKeyUp={onKey}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={ids}
        />
        <button type="button" className="pw__toggle" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-controls={id}>
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {caps && <p className="field__warn" id={`${id}-caps`}>Caps Lock is on.</p>}
      {children}
      {error && <p className="field__error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

function EmailField({ value, onChange, onBlur, error, inputRef, hint }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor="auth-email">Email</label>
      <input
        ref={inputRef}
        id="auth-email"
        type="email"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={MAX_EMAIL}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        aria-invalid={!!error}
        aria-describedby={[hint && 'auth-email-hint', error && 'auth-email-error'].filter(Boolean).join(' ') || undefined}
      />
      {hint && <p className="field__hint" id="auth-email-hint">{hint}</p>}
      {error && <p className="field__error" id="auth-email-error">{error}</p>}
    </div>
  );
}

function Alert({ children, tone = 'error' }) {
  return (
    <div className={tone === 'error' ? 'form-error' : 'form-note'} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'alert' : 'mail'} size={20} />
      <div>{children}</div>
    </div>
  );
}

// Shown on every auth screen until the backend exists.
function MockNotice({ onFill }) {
  return (
    <p className="mock-note">
      <strong>Preview:</strong> not connected to the server. Demo login <code>{DEMO.email}</code> / <code>{DEMO.password}</code>
      {onFill && <> · <button type="button" className="linklike mock-note__fill" onClick={onFill}>Fill in</button></>}
      {' '}· <a href={`#/welcome/${DEMO.invite}`}>Try an invite link</a>
    </p>
  );
}

function AuthFrame({ title, lede, children, contactEmail, onFill }) {
  const titleRef = useRef(null);
  useEffect(() => titleRef.current && titleRef.current.focus(), []);
  return (
    <div className="auth">
      <a className="back" href="#/"><Icon name="back" size={18} /> Back to supplies</a>
      <section className="auth__card">
        <h1 className="page-title" tabIndex={-1} ref={titleRef}>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
        {children}
      </section>
      <p className="auth__foot">
        Accounts are for Blueprints partner clinics. Need one? Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.<br />
        <a href="#/how-it-works">How does requesting work?</a>
      </p>
      <MockNotice onFill={onFill} />
    </div>
  );
}

const NEXT_LABEL = { review: 'to send your request', requests: 'to see your requests' };

export function SignIn({ next, onSignedIn, contactEmail, lineCount = 0 }) {
  const [values, setValues] = useState({ email: '', password: '' });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const emailRef = useRef(null);
  const pwRef = useRef(null);

  const errors = validateSignIn(values);
  const shown = { email: touched.email && errors.email, password: touched.password && errors.password };
  const update = (field) => (e) => {
    setValues((v) => ({ ...v, [field]: e.target.value }));
    if (error && error.code !== 'locked') setError(null);
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (inFlight.current) return;
    setTouched({ email: true, password: true });
    if (errors.email) return emailRef.current.focus();
    if (errors.password) return pwRef.current.focus();
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const account = await signIn({ email: cleanEmail(values.email), password: values.password });
      onSignedIn(account);
    } catch (err) {
      setError(err instanceof AuthError ? err : new AuthError('Couldn’t reach the server. Check your connection and try again.', { code: 'network' }));
      setValues((v) => ({ ...v, password: '' }));
      setTouched((t) => ({ ...t, password: false }));
      pwRef.current && pwRef.current.focus();
      inFlight.current = false;
      setSending(false);
    }
  };

  const locked = error && error.code === 'locked' && error.until > Date.now();

  return (
    <AuthFrame
      title={next === 'review' ? 'Sign in to send your request' : 'Sign in'}
      lede={next === 'review' && lineCount > 0
        ? `Your list of ${lineCount} ${lineCount === 1 ? 'supply is' : 'supplies is'} saved. Sign in and you’ll go straight back to it.`
        : next && NEXT_LABEL[next] ? `Sign in ${NEXT_LABEL[next]}.` : 'Blueprints for Pangaea partner clinics'}
      contactEmail={contactEmail}
      foot
      onFill={() => setValues({ email: DEMO.email, password: DEMO.password })}
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert>
            {error.code === 'mismatch' && (
              <p>
                <strong>That email and password don’t match.</strong> Check for typos, or{' '}
                <a href="#/forgot">reset your password</a>.
                {error.left <= 3 && ` ${error.left} ${error.left === 1 ? 'try' : 'tries'} left before a ${LOCK_MINUTES}-minute pause.`}
              </p>
            )}
            {error.code === 'locked' && (
              <p>
                <strong>Too many tries.</strong> To protect your account, sign-in is paused until {timeOf(error.until)}.
                You can <a href="#/forgot">reset your password</a> now instead.
              </p>
            )}
            {error.code === 'disabled' && (
              <p>
                <strong>This account has been turned off.</strong> If that seems wrong, email{' '}
                <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
              </p>
            )}
            {error.code === 'network' && <p>{error.message}</p>}
          </Alert>
        )}
        <EmailField
          inputRef={emailRef}
          value={values.email}
          onChange={update('email')}
          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
          error={shown.email}
        />
        <PasswordField
          id="auth-password"
          label="Password"
          inputRef={pwRef}
          autoComplete="current-password"
          value={values.password}
          onChange={update('password')}
          onBlur={() => values.password && setTouched((t) => ({ ...t, password: true }))}
          error={shown.password}
        />
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={sending || locked}>
          {sending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="auth__alt"><a href="#/forgot">Forgot password?</a></p>
      </form>
    </AuthFrame>
  );
}

export function ForgotPassword({ contactEmail }) {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [sent, setSent] = useState(null);
  const [sending, setSending] = useState(false);
  const ref = useRef(null);
  const err = touched ? emailError(email) : null;

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (emailError(email)) return ref.current.focus();
    setSending(true);
    await requestReset({ email: cleanEmail(email) });
    setSending(false);
    setSent(cleanEmail(email));
  };

  if (sent) {
    return (
      <AuthFrame title="Check your email" contactEmail={contactEmail}>
        <div className="auth__form">
          <Alert tone="note">
            <p>If <strong>{sent}</strong> has an account, we’ve sent it a link to choose a new password. The link works for 1 hour.</p>
          </Alert>
          <p className="auth__small">Nothing after a few minutes? Check spam, or email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
          <p className="auth__alt"><a href="#/signin">Back to sign in</a></p>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Reset your password" lede="We’ll email you a link to choose a new one." contactEmail={contactEmail}>
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <EmailField inputRef={ref} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} error={err} />
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={sending}>
          {sending ? 'Sending…' : 'Send reset link'}
        </button>
        <p className="auth__alt"><a href="#/signin">Back to sign in</a></p>
      </form>
    </AuthFrame>
  );
}

// Reached from the invite email HQ sends each clinic.
export function Welcome({ token, onSignedIn, contactEmail }) {
  const [invite, setInvite] = useState({ status: 'loading' });
  const [values, setValues] = useState({ password: '', confirm: '' });
  const [touched, setTouched] = useState({});
  const [sending, setSending] = useState(false);
  const pwRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    let live = true;
    lookupInvite(token)
      .then((data) => live && setInvite({ status: 'ok', ...data }))
      .catch((err) => live && setInvite({ status: 'bad', code: err.code }));
    return () => {
      live = false;
    };
  }, [token]);

  if (invite.status === 'loading') {
    return <div className="auth"><p className="hint" role="status">Checking your invite link…</p></div>;
  }
  if (invite.status === 'bad') {
    const copy = {
      expired: ['This invite link has expired', 'Invite links work for 7 days. Email us and we’ll send a new one.'],
      used: ['This invite was already used', 'Your account is set up. Sign in with your email and password.'],
      invalid: ['This link doesn’t work', 'It may have been copied incompletely. Open the link straight from the email, or email us for a new one.'],
    }[invite.code] || [];
    return (
      <AuthFrame title={copy[0]} lede={copy[1]} contactEmail={contactEmail}>
        <div className="auth__form">
          {invite.code === 'used'
            ? <a className="btn btn--primary btn--lg" href="#/signin">Go to sign in</a>
            : <a className="btn btn--secondary btn--lg" href={`mailto:${contactEmail}?subject=New%20invite%20link`}>Email us for a new link</a>}
        </div>
      </AuthFrame>
    );
  }

  const errors = validateNewPassword({ ...values, email: invite.email });
  const checks = passwordChecks(values.password, invite.email);
  const shown = { password: touched.password && errors.password, confirm: touched.confirm && errors.confirm };
  const update = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    if (sending) return;
    setTouched({ password: true, confirm: true });
    if (errors.password) return pwRef.current.focus();
    if (errors.confirm) return confirmRef.current.focus();
    setSending(true);
    const account = await acceptInvite(token, { password: values.password });
    onSignedIn(account, { welcome: true });
  };

  return (
    <AuthFrame
      title={`Welcome${invite.name ? `, ${invite.name.split(' ')[0]}` : ''}`}
      lede="Choose a password to finish setting up your account."
      contactEmail={contactEmail}
    >
      <form className="auth__form" onSubmit={onSubmit} noValidate>
        <dl className="invite">
          <div><dt>Clinic</dt><dd>{invite.org}</dd></div>
          <div><dt>Email</dt><dd>{invite.email}</dd></div>
        </dl>
        <p className="invite__wrong">Not your clinic? Stop here and email <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.</p>
        {/* Lets password managers save the right username. */}
        <input type="email" name="username" autoComplete="username" value={invite.email} readOnly hidden />
        <PasswordField
          id="new-password"
          label="New password"
          inputRef={pwRef}
          autoComplete="new-password"
          value={values.password}
          onChange={update('password')}
          onBlur={() => values.password && setTouched((t) => ({ ...t, password: true }))}
          error={shown.password}
          describedBy="pw-rules"
        >
          <ul className="rules" id="pw-rules" aria-label="Password rules">
            {checks.map((c) => (
              <li key={c.id} className={c.ok ? 'rules__ok' : undefined}>
                <Icon name={c.ok ? 'check' : 'minus'} size={16} />
                {c.label}
                <span className="visually-hidden">{c.ok ? ', done' : ', not yet'}</span>
              </li>
            ))}
          </ul>
        </PasswordField>
        <PasswordField
          id="confirm-password"
          label="Confirm password"
          inputRef={confirmRef}
          autoComplete="new-password"
          value={values.confirm}
          onChange={update('confirm')}
          onBlur={() => values.confirm && setTouched((t) => ({ ...t, confirm: true }))}
          error={shown.confirm}
        />
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={sending}>
          {sending ? 'Setting up…' : 'Finish setup'}
        </button>
      </form>
    </AuthFrame>
  );
}
