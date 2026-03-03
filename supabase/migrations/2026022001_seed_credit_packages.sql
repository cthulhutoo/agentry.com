-- Seed credit packages
INSERT INTO credit_packages (id, name, credits, price, bonus_credits, sort_order, is_active) VALUES
  ('pkg_starter', 'Starter Pack', 50, 5, 0, 1, true),
  ('pkg_standard', 'Standard Pack', 150, 15, 30, 2, true),
  ('pkg_pro', 'Pro Pack', 300, 30, 100, 3, true),
  ('pkg_enterprise', 'Enterprise Pack', 750, 75, 450, 4, true)
ON CONFLICT (id) DO UPDATE SET
  credits = EXCLUDED.credits,
  price = EXCLUDED.price,
  bonus_credits = EXCLUDED.bonus_credits,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

-- Create default pricing_plans if table exists
INSERT INTO pricing_plans (id, name, description, price, credits, features, sort_order, is_active)
SELECT * FROM (VALUES
  ('plan_basic', 'Basic', 'Perfect for getting started', 0, 10, ARRAY['5 tasks per month', '3 agents per council', 'Basic support'], 1, true),
  ('plan_pro', 'Pro', 'For power users and small teams', 29, 100, ARRAY['Unlimited tasks', '5 agents per council', 'Priority support', 'Custom agents'], 2, true),
  ('plan_enterprise', 'Enterprise', 'For organizations with advanced needs', 99, 500, ARRAY['Unlimited everything', '10 agents per council', 'Dedicated support', 'API access', 'Custom integrations'], 3, true)
) AS v(id, name, description, price, credits, features, sort_order, is_active)
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pricing_plans')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  credits = EXCLUDED.credits,
  features = EXCLUDED.features,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;
