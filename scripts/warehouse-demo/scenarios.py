"""Source-time choreography and scoring references for the warehouse fixtures."""

FPS = 10
CAMERAS = ('staging', 'aisle', 'dispatch')

# x, y and lift height are in meters. Linear interpolation gives exact source times.
TRANSFER = [
    (0, (-13.5, 0, 0)), (3, (-9, 0, 0)), (5, (-9, 0, 0)),
    (6, (-9, 0, .36)), (10, (-3.8, 0, .36)), (12, (-1, .3, .36)),
    (14, (1, 1.4, .36)), (17, (7, 1.4, .36)),
    (18, (7, 1.4, 0)), (20, (7, 1.4, 0)), (23, (4, 1.4, 0)),
]
LOOKALIKE = [
    (0, (-13.5, 2.8, 0)), (3, (-9, 2.8, 0)), (5, (-9, 2.8, 0)),
    (6, (-9, 2.8, .36)), (10, (-3.8, 2.8, .36)), (12, (-1.2, 2.5, .36)),
    (14, (-.4, 2.7, .36)), (16, (-.55, 3.35, .36)),
    (20, (-.6, 3.35, .36)), (23, (-.6, 3.35, .36)),
]
DWELL = [
    (0, (3, 1.4, 0)), (4, (7, 1.4, 0)), (6, (9, 1.4, 0)),
    (312, (9, 1.4, 0)), (314, (7, 1.4, 0)), (318, (3, 1.4, 0)),
]
ZONES = {
    'staging': [-11, -1.5, -5, 4.3],
    'transfer-aisle': [-5, -1.5, 5, 4.3],
    'dispatch': [5, -2, 13.6, 5],
    'loading-zone': [7, -.5, 11.5, 3.2],
}
PEDESTRIAN_ZONE = {'pedestrian-gate': [-10.4, -2.85, -7.4, -1.55]}
PALLET_OFFSET = 1.84
BRIDGE = (9, 18)


def position(path, second):
    for (start, p), (end, q) in zip(path, path[1:]):
        if second < end:
            fraction = (second - start) / (end - start)
            return tuple(a + (b - a) * fraction for a, b in zip(p, q))
    return path[-1][1]


def pallet_position(path, second, stays_on_forks=False):
    if second < 5:
        second = 5
    if not stays_on_forks:
        second = min(second, 18)
    x, y, lift = position(path, second)
    return (x + PALLET_OFFSET, y, lift)


def coverage_missing(scenario, camera, second):
    gap = scenario.get('gap')
    return gap is not None and camera == gap[0] and gap[1] <= second < gap[2]


SCENARIOS = {
    'transfer': dict(duration=24, second_forklift=False),
    'supported-handoff': dict(duration=24, second_forklift=True),
    'ambiguous-handoff': dict(duration=24, second_forklift=True, gap=('aisle', *BRIDGE)),
    'ground-position': dict(duration=7, ground_position=True),
    'dwell': dict(duration=320, dwell=True),
    'dwell-gap': dict(duration=320, dwell=True, gap=('dispatch', 155, 185)),
}


def reference(name, scenario):
    gap = scenario.get('gap')
    coverage_gaps = []
    if gap:
        camera, start, end = gap
        coverage_gaps.append(dict(camera=camera, startMs=start * 1000, endMs=end * 1000))
    identities = {'F1': 'forklift'}
    if scenario.get('dwell'):
        return dict(
            identities=identities, coverageGaps=coverage_gaps,
            groundTruth=dict(forklift='F1', zone='loading-zone', entryMs=4000,
                             qualifiesMs=304000, exitMs=314000),
            expected=dict(dwell='undecided' if gap else 'one-match'),
        )

    identities.update(P1='pallet', W1='person', B1='box')
    if scenario.get('ground_position'):
        return dict(identities=identities, coverageGaps=coverage_gaps,
                    expected=dict(pedestrianZone='pedestrian-gate', occluder='Foot occluder'))
    if scenario['second_forklift']:
        identities.update(F2='forklift', P2='pallet')
    result = dict(
        identities=identities, coverageGaps=coverage_gaps,
        groundTruth=dict(forklift='F1', pallet='P1', pickupMs=6000, deliveryMs=18000),
        evidenceWindows=[
            dict(camera='staging', startMs=2500, endMs=9500),
            dict(camera='aisle', startMs=7000, endMs=17500),
            dict(camera='dispatch', startMs=15000, endMs=22000),
        ],
        expected=dict(handoff='undecided' if gap else 'supported',
                      candidates=['F1', 'F2'] if gap else ['F1']),
    )
    if gap:
        result['evidenceWindows'][1]['endMs'] = gap[1] * 1000
        result['evidenceWindows'].append(dict(camera='aisle', startMs=gap[2] * 1000, endMs=22000))
    if name == 'supported-handoff':
        result['faultProfiles'] = {
            'delay': dict(bufferMs=30000, delaysMs={'aisle': 42000},
                          expectedBefore='undecided', expectedAfter='supported',
                          compareAtElapsedMs=48500, bridgeAvailableFromElapsedMs=53500),
            'outage': dict(bufferMs=30000, gapFixture='ambiguous-handoff',
                           expectedBefore='undecided', expectedAfter='undecided'),
        }
    return result
