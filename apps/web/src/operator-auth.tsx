import { createAuthClient } from 'better-auth/react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
    <Card className="mx-auto w-full max-w-md gap-0 p-6 sm:p-8" role="region" aria-labelledby="operator-title">
      <h2 id="operator-title" className="text-2xl font-semibold tracking-tight">
        {creating ? 'Create an operator account' : 'Sign in to your workspace'}
      </h2>
      <form onSubmit={submit} className="mt-6 grid gap-4">
        {creating && <div className="field">
          <Label htmlFor="operator-name">Name</Label>
          <Input id="operator-name" name="name" autoComplete="name" required maxLength={100} />
        </div>}
        <div className="field">
          <Label htmlFor="operator-email">Email</Label>
          <Input id="operator-email" type="email" name="email" autoComplete="email" required />
        </div>
        <div className="field">
          <Label htmlFor="operator-password">Password</Label>
          <Input id="operator-password" type="password" name="password" required maxLength={128}
            minLength={creating ? 8 : undefined} autoComplete={creating ? 'new-password' : 'current-password'} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Please wait…' : creating ? 'Create account' : 'Sign in'}
        </Button>
      </form>
      <Button variant="link" className="mt-3 self-start px-0" type="button" disabled={pending}
        onClick={() => { setCreating(!creating); setError(''); }}>
        {creating ? 'Back to sign in' : 'Create an account'}
      </Button>
    </Card>
  );
}
