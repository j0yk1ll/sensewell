import { createAuthClient } from 'better-auth/react';
import { useState, type FormEvent } from 'react';

export const authClient = createAuthClient();

export function SignIn() {
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = { email: String(form.get('email')), password: String(form.get('password')) };
    setPending(true);
    setError('');
    try {
      const result = creating
        ? await authClient.signUp.email({ ...credentials, name: String(form.get('name')).trim() })
        : await authClient.signIn.email(credentials);
      if (result.error) setError(result.error.message ?? 'Could not sign in.');
    } catch {
      setError('The sign-in service is unavailable. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel mx-auto w-full max-w-md p-6 sm:p-8" aria-labelledby="operator-title">
      <h2 id="operator-title" className="text-2xl font-semibold tracking-tight">
        {creating ? 'Create an operator account' : 'Sign in to your workspace'}
      </h2>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        {creating && <label className="field">Name<input name="name" autoComplete="name" required maxLength={100} /></label>}
        <label className="field">Email<input type="email" name="email" autoComplete="email" required /></label>
        <label className="field">Password<input
          type="password" name="password" required maxLength={128} minLength={creating ? 8 : undefined}
          autoComplete={creating ? 'new-password' : 'current-password'}
        /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary" disabled={pending}>
          {pending ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <button className="mt-5 text-sm font-semibold text-teal-800 underline underline-offset-4" type="button" disabled={pending}
        onClick={() => { setCreating(!creating); setError(''); }}>
        {creating ? 'Back to sign in' : 'Create an account'}
      </button>
    </section>
  );
}
