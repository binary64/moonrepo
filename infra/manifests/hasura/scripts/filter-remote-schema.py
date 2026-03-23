#!/usr/bin/env python3
"""Filter remote schema introspection JSON to remove INPUT_OBJECTs (Prisma bloat).

Reduces 20,857 types / 63MB → ~2,000 types / 4MB.
Keeps OBJECT, ENUM, SCALAR types + strips mutation args.
"""
import json, sys

data = json.load(sys.stdin)
schema = data['data']['__schema']

# Keep only OBJECT, ENUM, SCALAR — drop INPUT_OBJECT
schema['types'] = [t for t in schema['types'] if t['kind'] != 'INPUT_OBJECT']

# Strip mutation args (reference deleted INPUT_OBJECTs)
for t in schema['types']:
    if t.get('fields'):
        for field in t['fields']:
            field['args'] = []

schema['mutationType'] = None
schema['subscriptionType'] = None

json.dump(data, sys.stdout)
