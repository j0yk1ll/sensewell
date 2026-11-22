import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maxCameraNameLength, maxCameraStreamUrlLength, type IpCamera } from '@sensewell/contracts';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CameraEndpointSettings } from './camera-endpoint-settings';
import { cameraApi, CameraApiError } from './camera-api';
import { IpCameraViewer } from './ip-camera-viewer';
import { authClient } from './operator-auth';

export function CameraWorkspace({ operator }: { operator: { id: string; name: string } }) {
  const [selectedId, setSelectedId] = useState<string>();
  const queryClient = useQueryClient();
  const cameraKey = ['cameras', operator.id];
  const cameras = useQuery({
    queryKey: cameraKey,
    queryFn: ({ signal }) => cameraApi.list(signal),
    retry: false,
  });
  const selected = cameras.data?.find((camera) => camera.id === selectedId);

  const signOut = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message ?? 'Could not sign out.');
    },
  });

  function cameraAdded(camera: IpCamera) {
    queryClient.setQueryData<IpCamera[]>(cameraKey, (previous = []) => [...previous, camera]);
    void queryClient.invalidateQueries({ queryKey: cameraKey });
    setSelectedId(camera.id);
  }

  function cameraRemoved(cameraId: string) {
    queryClient.setQueryData<IpCamera[]>(cameraKey, (previous = []) => previous.filter(({ id }) => id !== cameraId));
    setSelectedId((current) => current === cameraId ? undefined : current);
    void queryClient.invalidateQueries({ queryKey: cameraKey });
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-9">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Camera workspace</h2>
          <p className="mt-2 text-slate-600">View live feeds and recordings.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="min-w-0 break-all text-sm text-slate-600">{operator.name}</span>
          <Button variant="outline" type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </div>

      {signOut.isError && <p className="error mb-4" role="alert">Could not sign out. Try again.</p>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <aside className="grid gap-5">
          <Card className="gap-0 overflow-hidden py-0" role="region" aria-labelledby="camera-list">
            <h3 id="camera-list" className="border-b border-slate-200 px-5 py-4 font-semibold">Cameras</h3>
            {cameras.isPending && <p className="p-5 text-sm text-slate-600" role="status">Loading cameras…</p>}
            {cameras.isError && <div className="grid gap-3 p-5">
              <p className="error" role="alert">{cameras.error.message}</p>
              <Button variant="outline" className="justify-self-start" type="button" onClick={() => void cameras.refetch()}>
                Retry
              </Button>
            </div>}
            {cameras.isSuccess && (cameras.data.length > 0
              ? <ul className="divide-y divide-slate-200">{cameras.data.map((camera) => (
                <li key={camera.id}>
                  <Button type="button" variant="ghost" aria-pressed={camera.id === selectedId}
                    className="h-auto w-full justify-start rounded-none px-5 py-3 text-left whitespace-normal wrap-anywhere aria-pressed:bg-accent aria-pressed:text-accent-foreground"
                    onClick={() => setSelectedId(camera.id)}>
                    {camera.name}
                  </Button>
                </li>
              ))}</ul>
              : <p className="p-5 text-sm text-slate-600">No cameras yet.</p>)}
          </Card>
          <AddCamera onAdded={cameraAdded} />
          <CameraEndpointSettings operatorId={operator.id} />
        </aside>

        {selected
          ? <IpCameraViewer key={selected.id} camera={selected} tenantId={operator.id}
              onRemoved={() => cameraRemoved(selected.id)} />
          : <Card className="grid min-h-60 place-content-center gap-2 px-6 text-center">
            <h3 className="text-lg font-semibold">Footage preview</h3>
            <p className="text-sm text-slate-600">
              {cameras.data?.length ? 'Select a camera to view its footage.' : 'Add a camera to view its footage.'}
            </p>
          </Card>}
      </div>
    </>
  );
}

function AddCamera({ onAdded }: { onAdded: (camera: IpCamera) => void }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const name = String(values.get('name')).trim();
    setError('');
    setPending(true);
    try {
      const camera = await cameraApi.connect({
        name, url: String(values.get('url')),
        username: String(values.get('username')), password: String(values.get('password')),
      });
      form.reset();
      onAdded(camera);
    } catch (problem) {
      if (problem instanceof CameraApiError && problem.status === 401) {
        setError('Your session expired. Sign in again.');
      } else {
        setError(problem instanceof Error ? problem.message : 'Could not add the camera. Try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="py-0">
      <form className="grid gap-4 p-5" onSubmit={submit}>
        <h3 className="font-semibold">Add a camera</h3>
        <div className="field">
          <Label htmlFor="camera-name">Camera name</Label>
          <Input id="camera-name" name="name" required maxLength={maxCameraNameLength}
            placeholder="Rack-side aisle" disabled={pending} />
        </div>
        <div className="field">
          <Label htmlFor="camera-url">RTSP stream URL</Label>
          <Input id="camera-url" name="url" type="url" placeholder="rtsp://192.0.2.10:554/stream"
            required maxLength={maxCameraStreamUrlLength} disabled={pending} />
        </div>
        <div className="field">
          <Label htmlFor="camera-username">Camera username (optional)</Label>
          <Input id="camera-username" name="username" autoComplete="off" maxLength={256} disabled={pending} />
        </div>
        <div className="field">
          <Label htmlFor="camera-password">Camera password (optional)</Label>
          <Input id="camera-password" name="password" type="password" autoComplete="off" maxLength={256} disabled={pending} />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <Button type="submit" className="whitespace-normal" disabled={pending}>
          {pending ? 'Adding camera…' : 'Connect IP camera'}
        </Button>
      </form>
    </Card>
  );
}
