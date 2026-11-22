export function groundZoneConfig(manifest, cameraName, zoneName) {
  const camera = manifest.cameras[cameraName];
  const [left, near, right, far] = manifest.zones[zoneName];
  const points = [[left, near], [right, near], [right, far], [left, far]]
    .map(([x, y]) => ({ x, y }));
  const image = ({ x, y }) => {
    const [u, v, w] = camera.floorToImage.map(([a, b, c]) => a * x + b * y + c);
    return { x: u / w, y: v / w };
  };
  // Blender's rendered landmark projections are fitted independently of
  // the camera matrix used to project these reference positions.
  const landmarks = points.map((floor, index) => ({ floor, image: camera.zones[zoneName][index] }));
  const checks = [0.25, 0.75].map((fraction) => {
    const floor = { x: left + (right - left) * fraction, y: near + (far - near) * (1 - fraction) };
    return { floor, image: image(floor) };
  });
  return { name: zoneName, points: camera.zones[zoneName], ground: {
    points, landmarks, checks, maxErrorM: 0.02, personToleranceM: 0.2, vehicleToleranceM: 0.65,
  } };
}
