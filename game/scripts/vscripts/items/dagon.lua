LinkLuaModifier( "modifier_intrinsic_multiplexer", "modifiers/modifier_intrinsic_multiplexer.lua", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier( "modifier_item_oaa_dagon_passive", "items/dagon.lua", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier( "modifier_item_oaa_dagon_debuff", "items/dagon.lua", LUA_MODIFIER_MOTION_NONE)
LinkLuaModifier( "modifier_item_spell_lifesteal_oaa", "modifiers/modifier_item_spell_lifesteal_oaa.lua", LUA_MODIFIER_MOTION_NONE )

item_dagon_oaa = class(ItemBaseClass)
item_dagon_oaa_2 = item_dagon_oaa
item_dagon_oaa_3 = item_dagon_oaa
item_dagon_oaa_4 = item_dagon_oaa
item_dagon_oaa_5 = item_dagon_oaa
item_dagon_oaa_6 = item_dagon_oaa
item_dagon_oaa_7 = item_dagon_oaa
item_dagon_oaa_8 = item_dagon_oaa
item_dagon_oaa_9 = item_dagon_oaa

function item_dagon_oaa:GetIntrinsicModifierName()
  return "modifier_intrinsic_multiplexer"
end

function item_dagon_oaa:GetIntrinsicModifierNames()
  return {
    "modifier_item_oaa_dagon_passive",
    "modifier_item_spell_lifesteal_oaa",
  }
end

function item_dagon_oaa:OnSpellStart()
  local caster = self:GetCaster()
  local target = self:GetCursorTarget()
  local level = self:GetLevel()

  local soundCaster = "DOTA_Item.Dagon.Activate"
  local soundTarget = "DOTA_Item.Dagon5.Target"

  local particleName = "particles/items/dagon_oaa.vpcf"
  local particleThickness = 300 + (100 * level) --Control Point 2 in Dagon's particle effect takes a number between 400 and 2000, depending on its level.

  local damage = self:GetSpecialValueFor("damage") -- Damage should never be a big value because of the spells like Fatal Bonds that share dmg
  local hp_percent = self:GetSpecialValueFor("current_hp_dmg")
  local damage_type = DAMAGE_TYPE_MAGICAL

  local particle = ParticleManager:CreateParticle(particleName,  PATTACH_POINT_FOLLOW, caster)
  ParticleManager:SetParticleControlEnt(particle, 0, caster, PATTACH_POINT_FOLLOW, "attach_attack1", caster:GetOrigin(), true)
  ParticleManager:SetParticleControlEnt(particle, 1, target, PATTACH_POINT_FOLLOW, "attach_hitloc", target:GetOrigin(), true)
  ParticleManager:SetParticleControl(particle, 2, Vector(particleThickness))
  ParticleManager:ReleaseParticleIndex(particle)

  -- Sound on caster
  caster:EmitSound(soundCaster)

  -- Sound on target
  target:EmitSound(soundTarget)

  -- Don't do anything if target has Linken's effect or it's spell-immune
  if target:TriggerSpellAbsorb(self) or target:IsMagicImmune() then
    return
  end

  -- If the target is an illusion, just kill it and don't do damage
  if target:IsIllusion() and not target:IsNull() and not target:IsStrongIllusionOAA() then
    target:Kill(self, caster)
    return
  end

  -- 7.33 now we want to instakill creeps (not ancients (unless?!?))
  if target:IsCreep() and not target:IsAncient() and not target:IsNull() then
    target:Kill(self, caster)
    return
  end

  -- Add debuff
  if level > 5 then
    target:AddNewModifier(caster, self, "modifier_item_oaa_dagon_debuff", {duration = self:GetSpecialValueFor("blind_duration")})
  end

  ApplyDamage({
    victim = target,
    attacker = caster,
    damage = damage + target:GetHealth() * hp_percent * 0.01,
    damage_type = damage_type,
    ability = self
  })

  local heal_amount = 0
  if damaged_unit:IsRealHero() then
    heal_amount = damage * (75 - self.hsl) / 100
  else
    -- Illusions are treated as creeps too
    heal_amount = damage * (75 - self.csl) / 100
  end

  if heal_amount > 0 then
    attacker:HealWithParams(heal_amount, self:GetAbility(), false, true, attacker, true)
    -- Particle
    local particle = ParticleManager:CreateParticle("particles/items3_fx/octarine_core_lifesteal.vpcf", PATTACH_ABSORIGIN_FOLLOW, attacker)
    ParticleManager:SetParticleControl(particle, 0, attacker:GetAbsOrigin())
    ParticleManager:ReleaseParticleIndex(particle)
  end
end

---------------------------------------------------------------------------------------------------

modifier_item_oaa_dagon_passive = class(ModifierBaseClass)

function modifier_item_oaa_dagon_passive:IsHidden()
  return true
end
function modifier_item_oaa_dagon_passive:IsDebuff()
  return false
end
function modifier_item_oaa_dagon_passive:IsPurgable()
  return false
end

function modifier_item_oaa_dagon_passive:GetAttributes()
  return MODIFIER_ATTRIBUTE_MULTIPLE
end

function modifier_item_oaa_dagon_passive:OnCreated()
  local ability = self:GetAbility()
  if ability and not ability:IsNull() then
    self.int = ability:GetSpecialValueFor("bonus_int")
    self.str = ability:GetSpecialValueFor("bonus_str")
    self.agi = ability:GetSpecialValueFor("bonus_agi")
    self.csl = ability:GetSpecialValueFor("creep_spell_lifesteal")
    --self.spell_amp = ability:GetSpecialValueFor("spell_amp")
  end
end

modifier_item_oaa_dagon_passive.OnRefresh = modifier_item_oaa_dagon_passive.OnCreated

function modifier_item_oaa_dagon_passive:DeclareFunctions()
  return {
    MODIFIER_PROPERTY_STATS_STRENGTH_BONUS,
    MODIFIER_PROPERTY_STATS_AGILITY_BONUS,
    MODIFIER_PROPERTY_STATS_INTELLECT_BONUS,
    --MODIFIER_PROPERTY_SPELL_AMPLIFY_PERCENTAGE,
  }
end

function modifier_item_oaa_dagon_passive:GetModifierBonusStats_Strength()
  return self.str or self:GetAbility():GetSpecialValueFor("bonus_str")
end

function modifier_item_oaa_dagon_passive:GetModifierBonusStats_Agility()
  return self.agi or self:GetAbility():GetSpecialValueFor("bonus_agi")
end

function modifier_item_oaa_dagon_passive:GetModifierBonusStats_Intellect()
  return self.int or self:GetAbility():GetSpecialValueFor("bonus_int")
end

--function modifier_item_oaa_dagon_passive:GetModifierSpellAmplify_Percentage()
  --return self.spell_amp or self:GetAbility():GetSpecialValueFor("spell_amp")
--end

---------------------------------------------------------------------------------------------------

modifier_item_oaa_dagon_debuff = class(ModifierBaseClass)

function modifier_item_oaa_dagon_debuff:IsHidden()
  return false
end

function modifier_item_oaa_dagon_debuff:IsDebuff()
  return true
end

function modifier_item_oaa_dagon_debuff:IsPurgable()
  return true
end

function modifier_item_oaa_dagon_debuff:OnCreated()
  local ability = self:GetAbility()
  if ability and not ability:IsNull() then
    self.blind_pct = ability:GetSpecialValueFor("blind_pct")
  end
end

modifier_item_oaa_dagon_debuff.OnRefresh = modifier_item_oaa_dagon_debuff.OnCreated

function modifier_item_oaa_dagon_debuff:DeclareFunctions()
  return {
    MODIFIER_PROPERTY_MISS_PERCENTAGE,
  }
end

function modifier_item_oaa_dagon_debuff:GetModifierMiss_Percentage()
  return self.blind_pct or self:GetAbility():GetSpecialValueFor("blind_pct")
end
