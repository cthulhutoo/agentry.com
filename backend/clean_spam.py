"""Clean spam orgs and fake private agents from store.json."""
import json

with open("store.json", "r") as f:
    data = json.load(f)

org_count = len(data["organizations"])
pa_count = len(data.get("private_agents", []))
print(f"Before: {org_count} orgs, {pa_count} private agents")

def is_spam_org(org):
    name = org.get("name", "")
    if len(name) > 10 and " " not in name:
        vowels = sum(1 for c in name.lower() if c in "aeiou")
        if vowels / max(len(name), 1) < 0.25:
            return True
        case_changes = sum(1 for i in range(1, len(name)) if name[i].isupper() != name[i-1].isupper())
        if case_changes > len(name) * 0.4:
            return True
    return False

spam_orgs = [o for o in data["organizations"] if is_spam_org(o)]
spam_org_ids = set()
for o in spam_orgs:
    spam_org_ids.add(o.get("id", ""))
    print(f"  Removing org: {o['name']} ({o['email']})")

data["organizations"] = [o for o in data["organizations"] if not is_spam_org(o)]

# Remove test/spam private agents
data["private_agents"] = [
    pa for pa in data.get("private_agents", [])
    if not pa.get("name", "").startswith("Limit Agent")
]

new_org_count = len(data["organizations"])
new_pa_count = len(data.get("private_agents", []))
print(f"After: {new_org_count} orgs, {new_pa_count} private agents")
print(f"Removed {org_count - new_org_count} orgs, {pa_count - new_pa_count} private agents")

with open("store.json", "w") as f:
    json.dump(data, f, indent=2)

print("Done - store.json saved")
