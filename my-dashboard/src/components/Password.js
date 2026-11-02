import { useEffect, useRef, useState } from 'react';
import { ApiError, changePassword, resetPassword } from '../api';
import { passwordError } from '../auth/validate';
import { fromServer } from '../useAccount';
import Icon from './Icons';
import { Field, PasswordInput } from './SignIn';

const message = (err) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

// The new password twice, with the same rules as signing up. Calls onSave(password).
function NewPasswordForm({ onSave, busy, button, error, children }) {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState({});
  const submit = (e) => {
    e.preventDefault();
    const problems = {
      password: passwordError(password),
      again: !passwordError(password) && again !== password ? 'The two passwords don’t match.' : null,
    };
    if (problems.password || problems.again) return setErrors(problems);
    setErrors({});
    onSave(password);
  };
  return (
    <form className="auth__form" onSubmit={submit} noValidate>
      {error && <p className="form-error" role="alert">{error}</p>}
      {children}
      <Field id="new-password" label="New password" error={errors.password}
        hint={!errors.password && <p className="field__hint">At least 10 characters. A few words together works well.</p>}>
        <PasswordInput id="new-password" value={password} autoComplete="new-password" onChange={setPassword}
          invalid={!!errors.password} describedBy={errors.password ? 'new-password-error' : undefined} />
      </Field>
      <Field id="new-again" label="Type it again" error={errors.again}>
        <PasswordInput id="new-again" value={again} autoComplete="new-password" onChange={setAgain}
          invalid={!!errors.again} describedBy={errors.again ? 'new-again-error' : undefined} />
      </Field>
      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>{busy ? 'Saving…' : button}</button>
    </form>
  );
}

function useTitleFocus() {
  const ref = useRef(null);
  useEffect(() => ref.current && ref.current.focus(), []);
  return ref;
}

// #/reset/<token>: the link a Blueprints team member sent. Sets the password and signs in.
export function ResetPassword({ token, onSignedIn, contactEmail }) {
  const titleRef = useTitleFocus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (password) => {
    setBusy(true);
    setError(null);
    try {
      onSignedIn(fromServer(await resetPassword(token, password)));
    } catch (err) {
      setError(err.status === 400 ? <>{err.message} (<a href={`mailto:${contactEmail}`}>{contactEmail}</a>)</> : message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <section className="auth__card">
        <h1 className="page-title" tabIndex={-1} ref={titleRef}>Choose a new password</h1>
        <p className="lede">This link works once. After this you’re signed in, and any other device using your old password is signed out.</p>
        <NewPasswordForm onSave={save} busy={busy} error={error} button="Save and sign in" />
      </section>
    </div>
  );
}

// #/password: change it while signed in (needs the current one).
export function ChangePassword({ account, onDone }) {
  const titleRef = useTitleFocus();
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async (password) => {
    if (!current) return setError('Enter your current password.');
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, password);
      onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth">
      <a className="back" href="#/"><Icon name="back" size={18} /> Back to supplies</a>
      <section className="auth__card">
        <h1 className="page-title" tabIndex={-1} ref={titleRef}>Change your password</h1>
        <p className="lede">For {account.email}. Other devices signed in to this account will be signed out.</p>
        <NewPasswordForm onSave={save} busy={busy} error={error} button="Change password">
          <Field id="current-password" label="Current password">
            <PasswordInput id="current-password" value={current} autoComplete="current-password" onChange={setCurrent} />
          </Field>
        </NewPasswordForm>
      </section>
    </div>
  );
}
