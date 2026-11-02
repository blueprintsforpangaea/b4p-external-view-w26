import { useEffect, useRef, useState } from 'react';
import { ApiError, checkEmailDomain, logIn, logOut, signUp } from '../api';
import { cleanEmail, emailError, emailTypo, MAX_EMAIL, MAX_PASSWORD, passwordError } from '../auth/validate';
import { fromServer } from '../useAccount';
import Icon from './Icons';

// Sign in, or create an account: email, clinic name and a password, then straight in (no code to
// type). `team` is the Blueprints team page: sign in only, and only team accounts get through.

const NEXT_LABEL = { review: 'to send your request', requests: 'to see your requests' };
const message = (err) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

// What to say when the email domain check finds a problem. Never blocking: a second click goes on.
const DOMAIN_WARNING = {
  'no-domain': (d) => `We couldn’t find the email domain “${d}”. Please check the spelling.`,
  'no-mail': (d) => `“${d}” doesn’t seem to accept email. Please check the address.`,
  disposable: () => 'That looks like a temporary inbox. Please use your clinic’s work email.',
};
const domainOf = (email) => cleanEmail(email).split('@')[1] || '';

// The server's verdict on a domain: 'ok', 'no-domain', 'no-mail', 'disposable' or 'unknown'.
// Any failure (offline, slow, older server) counts as 'unknown'. Remembered for the visit.
const checked = new Map();
function checkDomain(domain) {
  if (!checked.has(domain)) {
    checked.set(domain, checkEmailDomain(domain).then((r) => (r && r.result) || 'unknown', () => 'unknown'));
  }
  return checked.get(domain);
}

export function Field({ id, label, error, hint, children }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint}
      {error && <p className="field__error" id={`${id}-error`} role="alert">{error}</p>}
    </div>
  );
}

// A password box with a Show button, so people can check what they typed.
export function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, inputRef }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="password">
      <input id={id} ref={inputRef} type={shown ? 'text' : 'password'} autoComplete={autoComplete} maxLength={MAX_PASSWORD}
        value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy}
        spellCheck={false} autoCapitalize="off" />
      <button type="button" className="password__show" onClick={() => setShown((s) => !s)} aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}

export function SignIn({ next, onSignedIn, contactEmail, lineCount = 0, team = false }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'create'
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const titleRef = useRef(null);
  useEffect(() => titleRef.current && titleRef.current.focus(), [mode]);
  // The Sign in button is disabled while it's sending, which drops focus to the page. After an
  // answer that isn't a field problem, put focus back where the next try starts.
  useEffect(() => {
    if (!errors.form) return;
    const next = document.getElementById(errors.toSignIn ? 'auth-email' : 'auth-password');
    if (next) next.focus();
  }, [errors.form, errors.toSignIn]);

  const creating = mode === 'create' && !team;
  const fix = !errors.email ? emailTypo(email) : null;
  // {domain, result} from the domain check, and the domain someone chose to use anyway.
  const [domainCheck, setDomainCheck] = useState(null);
  const [allowed, setAllowed] = useState('');
  const domain = domainOf(email);
  const warning = creating && !fix && domainCheck && domainCheck.domain === domain && DOMAIN_WARNING[domainCheck.result]
    ? DOMAIN_WARNING[domainCheck.result](domain) : null;

  const switchTo = (m) => { setMode(m); setErrors({}); setPassword(''); setAgain(''); };

  // Leaving the email box checks its domain (new accounts only), so a typo shows before sending.
  const onEmailBlur = () => {
    if (!creating || emailError(email) || emailTypo(email)) return;
    const d = domainOf(email);
    checkDomain(d).then((result) => setDomainCheck({ domain: d, result }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const problems = {
      email: emailError(email),
      org: creating && !org.trim() ? 'Enter your clinic’s name.' : null,
      password: creating ? passwordError(password) : (password ? null : 'Enter your password.'),
      again: creating && !passwordError(password) && again !== password ? 'The two passwords don’t match.' : null,
    };
    if (Object.values(problems).some(Boolean)) return setErrors(problems);
    setBusy(true);
    setErrors({});
    try {
      if (creating && allowed !== domain) {
        // A doubtful domain stops the first try with a warning; trying again creates the account.
        const result = await checkDomain(domain);
        setDomainCheck({ domain, result });
        if (DOMAIN_WARNING[result]) {
          setAllowed(domain);
          return;
        }
      }
      const me = creating
        ? await signUp(cleanEmail(email), org.trim().slice(0, 200), password)
        : await logIn(cleanEmail(email), password);
      const account = fromServer(me);
      if (team && account.role !== 'hq') {
        logOut().catch(() => {}); // a clinic account: don't leave it half signed in here
        setErrors({ form: 'This isn’t a Blueprints team account. Clinics sign in from the main page.' });
        return;
      }
      onSignedIn(account, { welcome: creating });
    } catch (err) {
      if (err.status === 409) setErrors({ form: err.message, toSignIn: true });
      else setErrors({ form: message(err) });
    } finally {
      setBusy(false);
    }
  };

  const title = team ? 'Blueprints team sign in'
    : creating ? 'Create your account'
      : next === 'review' ? 'Sign in to send your request' : 'Sign in';
  const lede = team ? 'For Blueprints for Pangaea members.'
    : next === 'review' && lineCount > 0
      ? `Your list of ${lineCount} ${lineCount === 1 ? 'supply is' : 'supplies is'} saved. ${creating ? 'Create your account' : 'Sign in'} and you’ll go straight back to it.`
      : creating ? 'It takes a minute. You’ll use this email and password to sign in next time.'
        : next && NEXT_LABEL[next] ? `Sign in ${NEXT_LABEL[next]}.` : 'Sign in with your work email and password.';
  const said = (id) => (errors[id] ? `${id}-error` : undefined);

  return (
    <div className="auth">
      <a className="back" href="#/"><Icon name="back" size={18} /> Back to supplies</a>
      <section className="auth__card">
        <h1 className="page-title" tabIndex={-1} ref={titleRef}>{title}</h1>
        <p className="lede">{lede}</p>
        <form className="auth__form" onSubmit={submit} noValidate>
          {errors.form && (
            <p className="form-error" role="alert">
              {errors.form}
              {errors.toSignIn && <>{' '}<button type="button" className="linklike" onClick={() => switchTo('signin')}>Sign in</button></>}
            </p>
          )}
          <Field id="auth-email" label="Work email" error={errors.email}
            hint={fix ? (
              <p className="field__warn" role="status">
                Did you mean <strong>{fix}</strong>?{' '}
                <button type="button" className="linklike" onClick={() => setEmail(fix)}>Use this</button>
              </p>
            ) : warning && (
              <p className="field__warn" role="status">
                {warning}{allowed === domain && ' If it’s right, click Create account again.'}
              </p>
            )}>
            <input id="auth-email" type="email" inputMode="email" autoComplete={creating ? 'email' : 'username'} autoCapitalize="off"
              spellCheck={false} maxLength={MAX_EMAIL} value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: null })); }} onBlur={onEmailBlur}
              aria-invalid={!!errors.email} aria-describedby={said('email')} />
          </Field>
          {creating && (
            <Field id="auth-org" label="Clinic name" error={errors.org}>
              <input id="auth-org" autoComplete="organization" maxLength={200} value={org}
                onChange={(e) => { setOrg(e.target.value); setErrors((x) => ({ ...x, org: null })); }}
                aria-invalid={!!errors.org} aria-describedby={said('org')} />
            </Field>
          )}
          <Field id="auth-password" label={creating ? 'Choose a password' : 'Password'} error={errors.password}
            hint={creating && !errors.password && <p className="field__hint">At least 10 characters. A few words together works well.</p>}>
            <PasswordInput id="auth-password" value={password} autoComplete={creating ? 'new-password' : 'current-password'}
              onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: null })); }}
              invalid={!!errors.password} describedBy={said('password')} />
          </Field>
          {creating && (
            <Field id="auth-again" label="Type the password again" error={errors.again}>
              <PasswordInput id="auth-again" value={again} autoComplete="new-password"
                onChange={(v) => { setAgain(v); setErrors((x) => ({ ...x, again: null })); }}
                invalid={!!errors.again} describedBy={said('again')} />
            </Field>
          )}
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? (creating ? 'Creating…' : 'Signing in…') : (creating ? 'Create account' : 'Sign in')}
          </button>
        </form>
        {!team && (
          <p className="auth__alt">
            {creating
              ? <>Already have an account? <button type="button" className="linklike" onClick={() => switchTo('signin')}>Sign in</button></>
              : <>New here? <button type="button" className="linklike" onClick={() => switchTo('create')}>Create an account</button></>}
          </p>
        )}
        {!creating && (
          <p className="auth__alt">
            Forgot your password? Email <a href={`mailto:${contactEmail}`}>{contactEmail}</a> from your work email.
            The Blueprints team will send you a link to choose a new one.
          </p>
        )}
      </section>
      {!team && (
        <p className="auth__foot">
          Blueprints member? <a href="#/team/signin">Blueprints team sign in</a>
        </p>
      )}
    </div>
  );
}
