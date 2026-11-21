LinkLuaModifier("modifier_item_ristuls_devotion_passive", "items/ristuls_devotion.lua", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier("modifier_item_ristuls_devotion_aura_effect", "items/ristuls_devotion.lua", LUA_MODIFIER_MOTION_NONE)

-- Ristul's Devotion: Vladmir's Offering + Splintmail + Voodoo Mask (7.42), as an OAA 5-level item.
-- Aura stacking with the other Vladmir auras is strongest-wins for every value:
--   * vanilla Vladmir's Offering / Buckler auras can't be turned off from Lua, so this aura only adds
--     what is above them (own value - vanilla value, never below 0)
--   * vs Vladmir's Grimoire (also Lua), only the stronger aura gives the value, Ristul's wins ties

local RISTULS_AURA = "modifier_item_ristuls_devotion_aura_effect"
local GRIMOIRE_AURA = "modifier_item_vladmirs_grimoire_aura_effect"

-- Vanilla auras that give the same values: aura modifier name -> ability key
local VANILLA_AURAS = {
  armor_aura = {
    {"modifier_item_vladmir_aura", "armor_aura"},
    {"modifier_item_buckler_effect", "bonus_aoe_armor"},
  },
  mana_regen_aura = {
    {"modifier_item_vladmir_aura", "mana_regen_aura"},
  },
  lifesteal_aura = {
    {"modifier_item_vladmir_aura", "lifesteal_aura"},
  },
  damage_aura = {
    {"modifier_item_vladmir_aura", "damage_aura"},
  },
}

local function AuraValue(mod, key)
  if not mod or mod:IsNull() then
    return 0
  end
  local ability = mod:GetAbility()
  if not ability or ability:IsNull() then
    return 0
  end
  return ability:GetSpecialValueFor(key)
end

local function VanillaValue(parent, key)
  local total = 0
  for _, source in ipairs(VANILLA_AURAS[key] or {}) do
    local mod = parent:FindModifierByName(source[1])
    if mod then
      total = total + AuraValue(mod, source[2])
    end
  end
  return total
end

-- Is this aura instance the strongest Vladmir-family Lua aura on the parent for this key?
local function IsStrongest(mod, key)
  local parent = mod:GetParent()
  local own = AuraValue(mod, key)
  for _, other in ipairs(parent:FindAllModifiersByName(GRIMOIRE_AURA)) do
    if AuraValue(other, key) > own then
      return false
    end
  end
  return true
end

-- Value this aura instance adds after strongest-wins stacking
local function StackedValue(mod, key)
  if not IsStrongest(mod, key) then
    return 0
  end
  return math.max(0, AuraValue(mod, key) - VanillaValue(mod:GetParent(), key))
end

---------------------------------------------------------------------------------------------------

item_ristuls_devotion_1 = class(ItemBaseClass)

function item_ristuls_devotion_1:GetIntrinsicModifierName()
  return "modifier_item_ristuls_devotion_passive"
end

item_ristuls_devotion_2 = item_ristuls_devotion_1
item_ristuls_devotion_3 = item_ristuls_devotion_1
item_ristuls_devotion_4 = item_ristuls_devotion_1
item_ristuls_devotion_5 = item_ristuls_devotion_1

---------------------------------------------------------------------------------------------------

modifier_item_ristuls_devotion_passive = class(ModifierBaseClass)

function modifier_item_ristuls_devotion_passive:IsHidden()
  return true
end

function modifier_item_ristuls_devotion_passive:IsDebuff()
  return false
end

function modifier_item_ristuls_devotion_passive:IsPurgable()
  return false
end

function modifier_item_ristuls_devotion_passive:GetAttributes()
  return MODIFIER_ATTRIBUTE_MULTIPLE
end

function modifier_item_ristuls_devotion_passive:OnCreated()
  self:OnRefresh()
  if IsServer() then
    local parent = self:GetParent()

    -- Remove aura effect modifier from units in radius to force refresh (item upgrades)
    local units = FindUnitsInRadius(
      parent:GetTeamNumber(),
      parent:GetAbsOrigin(),
      nil,
      self:GetAuraRadius(),
      self:GetAuraSearchTeam(),
      self:GetAuraSearchType(),
      DOTA_UNIT_TARGET_FLAG_NONE,
      FIND_ANY_ORDER,
      false
    )

    local function RemoveAuraEffect(unit)
      unit:RemoveModifierByName(self:GetModifierAura())
    end

    foreach(RemoveAuraEffect, units)
  end
end

function modifier_item_ristuls_devotion_passive:OnRefresh()
  local ability = self:GetAbility()
  if ability and not ability:IsNull() then
    self.armor = ability:GetSpecialValueFor("armor")
    self.mana_regen = ability:GetSpecialValueFor("mana_regen")
    self.aura_radius = ability:GetSpecialValueFor("aura_radius")
  end
end

function modifier_item_ristuls_devotion_passive:DeclareFunctions()
  return {
    MODIFIER_PROPERTY_PHYSICAL_ARMOR_BONUS,
    MODIFIER_PROPERTY_MANA_REGEN_CONSTANT,
  }
end

function modifier_item_ristuls_devotion_passive:GetModifierPhysicalArmorBonus()
  return self.armor or self:GetAbility():GetSpecialValueFor("armor")
end

function modifier_item_ristuls_devotion_passive:GetModifierConstantManaRegen()
  return self.mana_regen or self:GetAbility():GetSpecialValueFor("mana_regen")
end

function modifier_item_ristuls_devotion_passive:IsAura()
  return true
end

function modifier_item_ristuls_devotion_passive:GetAuraSearchType()
  return bit.bor(DOTA_UNIT_TARGET_BASIC, DOTA_UNIT_TARGET_HERO)
end

function modifier_item_ristuls_devotion_passive:GetAuraSearchTeam()
  return DOTA_UNIT_TARGET_TEAM_FRIENDLY
end

function modifier_item_ristuls_devotion_passive:GetAuraRadius()
  return self.aura_radius or self:GetAbility():GetSpecialValueFor("aura_radius")
end

function modifier_item_ristuls_devotion_passive:GetModifierAura()
  return RISTULS_AURA
end

---------------------------------------------------------------------------------------------------
-- Aura effect

modifier_item_ristuls_devotion_aura_effect = class({})

function modifier_item_ristuls_devotion_aura_effect:IsHidden()
  return false
end

function modifier_item_ristuls_devotion_aura_effect:IsDebuff()
  return false
end

function modifier_item_ristuls_devotion_aura_effect:IsPurgable()
  return false
end

function modifier_item_ristuls_devotion_aura_effect:DeclareFunctions()
  return {
    MODIFIER_PROPERTY_PHYSICAL_ARMOR_BONUS,
    MODIFIER_PROPERTY_MANA_REGEN_CONSTANT,
    MODIFIER_PROPERTY_BASEDAMAGEOUTGOING_PERCENTAGE,
    MODIFIER_PROPERTY_TOOLTIP,
    MODIFIER_PROPERTY_TOOLTIP2,
    MODIFIER_EVENT_ON_TAKEDAMAGE,
  }
end

function modifier_item_ristuls_devotion_aura_effect:GetModifierPhysicalArmorBonus()
  return StackedValue(self, "armor_aura")
end

function modifier_item_ristuls_devotion_aura_effect:GetModifierConstantManaRegen()
  return StackedValue(self, "mana_regen_aura")
end

function modifier_item_ristuls_devotion_aura_effect:GetModifierBaseDamageOutgoing_Percentage()
  return StackedValue(self, "damage_aura")
end

function modifier_item_ristuls_devotion_aura_effect:OnTooltip()
  return AuraValue(self, "lifesteal_aura")
end

function modifier_item_ristuls_devotion_aura_effect:OnTooltip2()
  return AuraValue(self, "spell_lifesteal_aura")
end

function modifier_item_ristuls_devotion_aura_effect:GetTexture()
  return "item_ristuls_devotion"
end

if IsServer() then
  function modifier_item_ristuls_devotion_aura_effect:OnTakeDamage(event)
    local parent = self:GetParent()
    local ability = self:GetAbility()
    local attacker = event.attacker
    local damaged_unit = event.unit
    local damage = event.damage

    if not ability or ability:IsNull() then
      return
    end

    -- Only the unit with this aura heals
    if not attacker or attacker:IsNull() or attacker ~= parent then
      return
    end

    -- Check if damaged entity exists, ignore self damage
    if not damaged_unit or damaged_unit:IsNull() or damaged_unit == attacker then
      return
    end

    -- Check if entity is an item, rune or something weird
    if damaged_unit.GetUnitName == nil then
      return
    end

    -- Don't affect buildings, wards and invulnerable units.
    if damaged_unit:IsTower() or damaged_unit:IsBarracks() or damaged_unit:IsBuilding() or damaged_unit:IsOther() or damaged_unit:IsInvulnerable() then
      return
    end

    -- Don't heal while dead
    if not attacker:IsAlive() or damage <= 0 then
      return
    end

    if event.inflictor and not event.inflictor:IsNull() then
      self:SpellLifesteal(event)
    elseif event.damage_category == DOTA_DAMAGE_CATEGORY_ATTACK and event.damage_type == DAMAGE_TYPE_PHYSICAL then
      self:AttackLifesteal(event)
    end
  end

  -- Attack lifesteal, like Vladmir's Offering (creeps 60%, illusions half)
  function modifier_item_ristuls_devotion_aura_effect:AttackLifesteal(event)
    local attacker = event.attacker
    local damaged_unit = event.unit
    local lifesteal_percent = StackedValue(self, "lifesteal_aura")

    if lifesteal_percent <= 0 then
      return
    end

    -- Reduce lifesteal percent when calculating lifesteal against illusions because they receive more dmg
    if damaged_unit:IsIllusion() then
      lifesteal_percent = lifesteal_percent / 2
    end

    -- Reduce lifesteal against creeps by 40% (DOTA_ATTACK_LIFESTEAL_CREEP_FACTOR)
    if damaged_unit:IsCreep() and not damaged_unit:IsOAABoss() and not damaged_unit:IsCreepHero() then
      lifesteal_percent = lifesteal_percent * 0.6
    end

    attacker:HealWithParams(event.damage * lifesteal_percent * 0.01, self:GetAbility(), true, true, attacker, false)

    local particle = ParticleManager:CreateParticle("particles/generic_gameplay/generic_lifesteal.vpcf", PATTACH_ABSORIGIN_FOLLOW, attacker)
    ParticleManager:ReleaseParticleIndex(particle)
  end

  -- Spell lifesteal for allies in the aura. Same filters as modifier_item_spell_lifesteal_oaa, inlined because
  -- that modifier divides by the number of the same item in the holder's own inventory (allies would get 0).
  function modifier_item_ristuls_devotion_aura_effect:SpellLifesteal(event)
    local attacker = event.attacker
    local damaged_unit = event.unit
    local flags = event.damage_flags
    local dmg_type = event.damage_type

    local succubus = attacker:FindAbilityByName("queenofpain_succubus")
    local isSuccubus = succubus and succubus:GetLevel() > 0
    local spellLifestealReflected = false
    if isSuccubus then
      spellLifestealReflected = succubus:GetSpecialValueFor("lifesteal_reflected") == 1
    end

    -- Ignore pure damage
    if dmg_type == DAMAGE_TYPE_PURE and not isSuccubus then
      return
    end

    -- Ignore damage that has the no-reflect or no-spell-lifesteal flag (except Bondage on magical/pure)
    if bit.band(flags, DOTA_DAMAGE_FLAG_REFLECTION) > 0 or bit.band(flags, DOTA_DAMAGE_FLAG_NO_SPELL_LIFESTEAL) > 0 then
      if dmg_type ~= DAMAGE_TYPE_MAGICAL and dmg_type ~= DAMAGE_TYPE_PURE then
        return
      end
      if not spellLifestealReflected then
        return
      end
    end

    local heal_percent
    if damaged_unit:IsRealHero() or damaged_unit:IsStrongIllusionOAA() then
      heal_percent = AuraValue(self, "spell_lifesteal_aura")
    else
      -- Illusions are treated as creeps too
      heal_percent = AuraValue(self, "creep_spell_lifesteal_aura")
    end

    local heal_amount = event.damage * heal_percent / 100
    if heal_amount > 0 then
      attacker:HealWithParams(heal_amount, self:GetAbility(), false, true, attacker, true)
      local particle = ParticleManager:CreateParticle("particles/items3_fx/octarine_core_lifesteal.vpcf", PATTACH_ABSORIGIN_FOLLOW, attacker)
      ParticleManager:SetParticleControl(particle, 0, attacker:GetAbsOrigin())
      ParticleManager:ReleaseParticleIndex(particle)
    end
  end
end
