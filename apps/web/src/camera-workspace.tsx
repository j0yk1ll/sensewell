import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { maxCameraNameLength, maxClipBytes, maxClipMiB, type SyntheticCamera } from '@sensewell/contracts';
import { useState, type FormEvent } from 'react';
import { cameraApi, CameraApiError } from './camera-api';
import { CameraViewer } from './camera-viewer';
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

  function cameraAdded(camera: SyntheticCamera) {
    queryClient.setQueryData<SyntheticCamera[]>(cameraKey, (previous = []) => [...previous, camera]);
    void queryClient.invalidateQueries({ queryKey: cameraKey });
    setSelectedId(camera.id);
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-9">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Synthetic Cameras</h2>
          <p className="mt-2 text-slate-600">Preview recorded footage and start a replay when you’re ready.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="min-w-0 break-all text-sm text-slate-600">{operator.name}</span>
          <button className="button" type="button" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            {signOut.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>

      {signOut.isError && <p className="error mb-4" role="alert">Could not sign out. Try again.</p>}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <aside className="grid gap-5">
          <section className="panel overflow-hidden" aria-labelledby="camera-list">
            <h3 id="camera-list" className="border-b border-slate-200 px-5 py-4 font-semibold">Cameras</h3>
            {cameras.isPending && <p className="p-5 text-sm text-slate-600" role="status">Loading cameras…</p>}
            {cameras.isError && <div className="grid gap-3 p-5">
              <p className="error" role="alert">{cameras.error.message}</p>
              <button className="button justify-self-start" type="button" onClick={() => void cameras.refetch()}>
                Retry
              </button>
            </div>}
            {cameras.isSuccess && (cameras.data.length > 0
              ? <ul className="divide-y divide-slate-200">{cameras.data.map((camera) => (
                <li key={camera.id}>
                  <button type="button" aria-pressed={camera.id === selectedId}
                    className="block w-full px-5 py-3 text-left font-medium wrap-anywhere hover:bg-slate-50 aria-pressed:bg-teal-50 aria-pressed:text-teal-900"
                    onClick={() => setSelectedId(camera.id)}>
                    {camera.name}
                  </button>
                </li>
              ))}</ul>
              : <p className="p-5 text-sm text-slate-600">No Synthetic Cameras yet.</p>)}
          </section>
          <AddCamera onAdded={cameraAdded} />
        </aside>

        {selected
          ? <CameraViewer key={selected.id} camera={selected} tenantId={operator.id} />
          : <section className="panel grid min-h-60 place-content-center gap-2 px-6 text-center">
            <h3 className="text-lg font-semibold">Footage preview</h3>
            <p className="text-sm text-slate-600">
              {cameras.data?.length ? 'Select a camera to open its source clip.' : 'Add a camera to preview a clip.'}
            </p>
          </section>}
      </div>
    </>
  );
}

function AddCamera({ onAdded }: { onAdded: (camera: SyntheticCamera) => void }) {
  const [formError, setFormError] = useState('');
  const upload = useMutation({ mutationFn: ({ name, clip }: { name: string; clip: File }) => cameraApi.add(name, clip) });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const clip = values.get('clip');
    const name = String(values.get('name')).trim();
    upload.reset();
    setFormError('');
    if (!name || !(clip instanceof File) || !clip.size) {
      setFormError('Enter a camera name and choose an MP4 clip.');
      return;
    }
    if (clip.size > maxClipBytes) {
      setFormError(`Choose a clip up to ${maxClipMiB} MiB.`);
      return;
    }

    try {
      const camera = await upload.mutateAsync({ name, clip });
      form.reset();
      onAdded(camera);
    } catch {
      // The mutation exposes the upload error below.
    }
  }

  const expired = upload.error instanceof CameraApiError && upload.error.status === 401;
  const error = expired ? 'Your session expired. Sign in again.' : formError || upload.error?.message;
  return (
    <form className="panel grid gap-4 p-5" onSubmit={submit}>
      <h3 className="font-semibold">Add a camera</h3>
      <label className="field">Camera name
        <input name="name" required maxLength={maxCameraNameLength} placeholder="Rack-side aisle" disabled={upload.isPending} />
      </label>
      <label className="field">MP4 clip
        <input type="file" name="clip" accept=".mp4,video/mp4" required disabled={upload.isPending}
          aria-describedby="clip-format" />
        <span id="clip-format" className="text-xs font-normal text-slate-600">H.264 video, up to {maxClipMiB} MiB.</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button primary" disabled={upload.isPending}>
        {upload.isPending ? 'Uploading and checking clip…' : 'Add Synthetic Camera'}
      </button>
    </form>
  );
}
