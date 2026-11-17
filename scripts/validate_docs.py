#!/usr/bin/env python3
"""Validate documentation structure/examples; no backend/runtime behavior implied."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
errors = []
# Validate our documents, not installed dependencies or generated local state.
markdown = sorted([*ROOT.glob('*.md'), *(ROOT / 'docs').rglob('*.md')])
link_count = 0
for source in markdown:
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', source.read_text()):
        parsed = urlsplit(target)
        if parsed.scheme or target.startswith('#'):
            continue
        destination = (source.parent / unquote(parsed.path)).resolve()
        link_count += 1
        if not destination.exists():
            errors.append(f'{source.relative_to(ROOT)}: missing link {target}')

if len(list((ROOT / 'docs').glob('*.md'))) != 10:
    errors.append('Expected ten numbered specification documents')
if not (ROOT / 'diagrams/message-flow.html').exists():
    errors.append('Missing interactive flow walkthrough')

examples = {}
for path in sorted((ROOT / 'examples').glob('*.json')):
    try:
        examples[path.stem] = json.loads(path.read_text())
    except (ValueError, OSError) as error:
        errors.append(f'{path.name}: {error}')

def check(condition, message):
    if not condition:
        errors.append(message)

required = {'send-request', 'send-response', 'delivery', 'reply-request', 'runtime-receipt'}
check(required <= examples.keys(), 'Missing protocol example')
if required <= examples.keys():
    send, stored, delivery, reply, receipt = [examples[key] for key in (
        'send-request', 'send-response', 'delivery', 'reply-request', 'runtime-receipt')]
    for name, example in examples.items():
        check(example.get('protocolVersion') == 'agentbus.remote.v1', f'{name}: wrong protocol')
    for example in (send, reply):
        try:
            UUID(example['requestId'])
        except (ValueError, KeyError):
            errors.append('Invalid request ID')
        check('fromAgentId' not in example and 'sender' not in example, 'Sender must derive from authentication')
    check(send['requestId'] != reply['requestId'], 'Different operations need distinct IDs')
    check(send['contextId'] == delivery['contextId'] == reply['contextId'], 'Context mismatch')
    check(send['body'] == delivery['body'], 'Immutable message body mismatch')
    check(send['recipientAgentIds'] == delivery['recipientAgentIds'], 'Recipient mismatch')
    check(stored['messageId'] == delivery['messageId'] == reply['replyTo'], 'Reply/message reference mismatch')
    check(stored['conversationSeq'] == delivery['conversationSeq'], 'Conversation sequence mismatch')
    check(stored['deliveries'][0]['deliveryId'] == delivery['deliveryId'], 'Delivery reference mismatch')
    check(stored['deliveries'][0]['recipientInboxSeq'] == delivery['recipientInboxSeq'], 'Inbox sequence mismatch')
    check(receipt['deliveryIds'] == [delivery['deliveryId']], 'Receipt references wrong delivery')
    check(receipt['agentId'] == delivery['recipientAgentId'], 'Receipt agent mismatch')
    check(reply['recipientAgentIds'] == [delivery['sender']['agentId']], 'Reply routed to wrong sender')
    check(stored['status'] == 'stored' and delivery['state'] == 'pending', 'Stored is not runtime acceptance')
    check(receipt['phase'] == 'runtime_accepted', 'Invalid receipt example phase')

if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print(f'Validated {len(markdown)} Markdown files, {link_count} local links, '
      f'{len(examples)} JSON examples, and cross-example protocol invariants.')
