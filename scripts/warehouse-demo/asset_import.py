"""Transcode the provided glTF textures for Blender while preserving meshes and rigs."""

import json
import struct
import subprocess
from pathlib import Path


def blender_glb(source: Path, work: Path):
    output = work / source.name
    if output.exists():
        return output

    contents = source.read_bytes()
    magic, version, _, json_size, json_type = struct.unpack_from('<4sIII4s', contents)
    assert (magic, version, json_type) == (b'glTF', 2, b'JSON')
    doc = json.loads(contents[20:20 + json_size])
    for key in ('extensionsUsed', 'extensionsRequired'):
        if 'KHR_texture_basisu' in doc.get(key, []):
            doc[key].remove('KHR_texture_basisu')
    for texture in doc['textures']:
        texture['source'] = texture['extensions'].pop('KHR_texture_basisu')['source']
        if not texture['extensions']:
            del texture['extensions']

    start = 28 + json_size
    binary = bytearray(contents[start:start + doc['buffers'][0]['byteLength']])
    for image in doc['images']:
        view = doc['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset', 0)
        compressed = work / 'texture.ktx2'
        decoded = work / 'texture.png'
        compressed.write_bytes(binary[offset:offset + view['byteLength']])
        subprocess.run(['ktx', 'extract', '--transcode', 'rgba8', str(compressed), str(decoded)], check=True)
        png = decoded.read_bytes()
        binary.extend(b'\0' * (-len(binary) % 4))
        # Give the new image its own view. Other GLB offsets stay untouched.
        image['bufferView'] = len(doc['bufferViews'])
        image['mimeType'] = 'image/png'
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(png)})
        binary.extend(png)

    binary.extend(b'\0' * (-len(binary) % 4))
    doc['buffers'][0]['byteLength'] = len(binary)
    metadata = json.dumps(doc, separators=(',', ':')).encode()
    metadata += b' ' * (-len(metadata) % 4)
    output.write_bytes(
        struct.pack('<4sIII4s', b'glTF', 2, 28 + len(metadata) + len(binary), len(metadata), b'JSON')
        + metadata + struct.pack('<I4s', len(binary), b'BIN\0') + binary
    )
    return output
