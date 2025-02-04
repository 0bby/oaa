LinkLuaModifier( "modifier_core_shrine_effect", "abilities/misc/core_shrine.lua", LUA_MODIFIER_MOTION_NONE )

---------------------------------------------------------------------------------------------------

modifier_core_shrine_effect = class(ModifierBaseClass)

function modifier_core_shrine_effect:OnCreated()
  if IsServer() then
    if self:GetAbility():IsCooldownReady() then
      if self:GetAbility():GetName() == "core_guy_score_limit" then
        --print('Setting stack to 1')
        self:SetStackCount(1)
      else
        --print('Setting stack to 2')
        self:SetStackCount(2)
      end
    else
      --print('Setting stack to 0')
      self:SetStackCount(0)
    end
  end
end

modifier_core_shrine_effect.OnRefresh = modifier_core_shrine_effect.OnCreated

function modifier_core_shrine_effect:GetEffectName()
  local stackCount = self:GetStackCount()
  --print(stackCount)
  if stackCount == 0 then
    return
  end
  if stackCount == 1 then
    return "particles/misc/aqua_oaa_rays.vpcf"
  elseif stackCount == 2 then
    return "particles/misc/ruby_oaa_rays.vpcf"
  end
end

---------------------------------------------------------------------------------------------------

modifier_core_shrine = class(ModifierBaseClass)

function modifier_core_shrine:IsHidden()
  return true
end

function modifier_core_shrine:IsPurgable()
  return false
end

function modifier_core_shrine:OnCreated()
  if IsServer() then
    self:GetAbility():StartCooldown(self:GetAbility():GetCooldown())
    self:StartIntervalThink(1)
  end
end

modifier_core_shrine.OnRefresh = modifier_core_shrine.OnCreated

function modifier_core_shrine:OnIntervalThink()
  self:CheckEffectModifier()
end

function modifier_core_shrine:DeclareFunctions()
  return {
    MODIFIER_EVENT_ON_ORDER,
  }
end

function modifier_core_shrine:CheckState()
  return {
    [MODIFIER_STATE_MAGIC_IMMUNE] = true,
    [MODIFIER_STATE_ATTACK_IMMUNE] = true,
    [MODIFIER_STATE_NO_HEALTH_BAR] = true,
    [MODIFIER_STATE_INVULNERABLE] = true,
  }
end

if IsServer() then
  function modifier_core_shrine:CheckEffectModifier()
    if self.effectMod and self.effectMod:IsNull() then
      self.effectMod = nil
    end

    if self:GetAbility():IsCooldownReady() and not self.effectMod then
      local parent = self:GetParent()
      self:GetParent():RemoveModifierByName("modifier_core_shrine_effect")
      --print('applying modifier!')
      self.effectMod = parent:AddNewModifier(parent, self:GetAbility(), "modifier_core_shrine_effect", {})
      self:StartIntervalThink(-1)
    elseif not self:GetAbility():IsCooldownReady() and self.effectMod then
      self.effectMod = nil
      --print('removing modifier!')
      self:GetParent():RemoveModifierByName("modifier_core_shrine_effect")
      self:StartIntervalThink(1)
    end
  end

  function modifier_core_shrine:OnOrder(params)
    local parent = self:GetParent() -- shrine entity
    local hOrderedUnit = params.unit
    local hTargetUnit = params.target
    local nOrderType = params.order_type

    if nOrderType ~= DOTA_UNIT_ORDER_MOVE_TO_TARGET then
      return
    end

    if not hTargetUnit or hTargetUnit ~= parent then
      return
    end

    if not hOrderedUnit or not hOrderedUnit:IsRealHero() or hOrderedUnit:GetTeamNumber() ~= parent:GetTeamNumber() then
      return
    end

    local distance = (hOrderedUnit:GetAbsOrigin() - parent:GetAbsOrigin()):Length2D()

    if not self:GetAbility():IsCooldownReady() then
      -- Call Grendel if ordered unit is near the shrine
      if distance < 300 then
        Grendel:GoNearTeam(parent:GetTeamNumber())
      end
      return
    end

    if distance < 300 then
      self:GetAbility():CastAbility()
      self:CheckEffectModifier()
    end
  end
end
