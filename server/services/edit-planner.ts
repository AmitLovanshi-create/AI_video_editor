import {
  editPlanSchema,
  type EditPlan,
} from '../schemas/edit-plan.schema'

export function validateEditPlan(input: unknown): EditPlan {
  return editPlanSchema.parse(input)
}