import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { canManageRole, Role, type IBaseRole, type IRole } from '@teable/core';
import type {
  CollaboratorItem,
  IAddCollaborator,
  UpdateBaseCollaborateRo,
  UpdateSpaceCollaborateRo,
} from '@teable/openapi';
import {
  addSpaceCollaborator,
  CollaboratorType,
  deleteBaseCollaborator,
  deleteSpaceBaseCollaborators,
  deleteSpaceCollaborator,
  getSpaceUniqueCollaboratorList,
  PrincipalType,
  updateBaseCollaborator,
  updateSpaceCollaborator,
} from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import { useSession } from '@teable/sdk/hooks';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { Trans, useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import { useSeatConfirm } from '../../../hooks/useSeatConfirm';
import { useFilteredRoleStatic as useFilteredBaseRoleStatic } from '../../collaborator-manage/base/useFilteredRoleStatic';
import { useFilteredRoleStatic } from '../../collaborator-manage/space/useFilteredRoleStatic';
import { uniqueCollaboratorToSpaceItem } from '../../collaborator-manage/utils';
import { CollaboratorsDialog } from '../share/CollaboratorsDialog';
import { CollaboratorButton } from '../share/common/CollaboratorButton';
import { CollaboratorTable } from '../share/common/CollaboratorTable';
import { DebounceInput } from '../share/common/DebounceInput';
import { ShareHeader } from '../share/common/Header';
import { InviteOrgButton } from '../share/common/InviteOrgButton';
import { OrgContent } from '../share/common/OrgContent';

interface IInviteSpaceContentProps {
  spaceId: string;
  spaceName: string;
  role: IRole;
  onClose: () => void;
  onSubPageChange: (isSubPage: boolean) => void;
}

interface IDeleteCollaboratorContext {
  resourceId: string;
  principalId: string;
  principalType: PrincipalType;
  isBase: boolean;
}

const MEMBERS_PER_PAGE = 50;

export const InviteSpaceContent = (props: IInviteSpaceContentProps) => {
  const { spaceId, spaceName, role: userRole, onClose, onSubPageChange } = props;
  const { t } = useTranslation('common');
  const { user } = useSession();
  const [tabType, setTabType] = useState<'organization' | 'collaborators' | undefined>();
  const confirmSeat = useSeatConfirm({ spaceId });

  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const {
    data,
    hasNextPage,
    fetchNextPage,
    isLoading: isListLoading,
  } = useInfiniteQuery({
    queryKey: ReactQueryKeys.spaceUniqueCollaboratorList(spaceId, { search }),
    staleTime: 1000,
    refetchOnWindowFocus: false,
    queryFn: ({ queryKey, pageParam }) =>
      getSpaceUniqueCollaboratorList(queryKey[1], {
        ...queryKey[2],
        skip: pageParam * MEMBERS_PER_PAGE,
        take: MEMBERS_PER_PAGE,
      }).then((res) => res.data),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const allCollaborators = pages.flatMap((page) => page.collaborators);
      return allCollaborators.length >= lastPage.total ? undefined : pages.length;
    },
  });

  const total = data?.pages?.[0]?.total || 0;
  const collaborators = useMemo(() => {
    return data?.pages.flatMap((page) => page.collaborators) || [];
  }, [data]);
  const previewCollaborators = useMemo(
    () => collaborators.slice(0, 4).map(uniqueCollaboratorToSpaceItem),
    [collaborators]
  );

  const { mutate: deleteCollaborator, isPending: deleteCollaboratorLoading } = useMutation({
    mutationFn: ({ resourceId, principalId, principalType, isBase }: IDeleteCollaboratorContext) =>
      isBase
        ? deleteBaseCollaborator({
            baseId: resourceId,
            deleteBaseCollaboratorRo: { principalId, principalType },
          })
        : deleteSpaceCollaborator({
            spaceId: resourceId,
            deleteSpaceCollaboratorRo: { principalId, principalType },
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceUniqueCollaboratorList(spaceId),
      });
    },
  });

  const { mutate: deletePrincipalBaseGrants, isPending: deletePrincipalLoading } = useMutation({
    mutationFn: ({
      principalId,
      principalType,
    }: {
      principalId: string;
      principalType: PrincipalType;
    }) =>
      deleteSpaceBaseCollaborators({
        spaceId,
        deleteSpaceCollaboratorRo: { principalId, principalType },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceUniqueCollaboratorList(spaceId),
      });
    },
  });

  const { mutate: updateCollaborator, isPending: updateCollaboratorLoading } = useMutation({
    mutationFn: ({
      resourceId,
      isBase,
      updateCollaborateRo,
    }: {
      resourceId: string;
      isBase: boolean;
      updateCollaborateRo: UpdateSpaceCollaborateRo;
    }) =>
      isBase
        ? updateBaseCollaborator({
            baseId: resourceId,
            updateBaseCollaborateRo: updateCollaborateRo as UpdateBaseCollaborateRo,
          })
        : updateSpaceCollaborator({
            spaceId: resourceId,
            updateSpaceCollaborateRo: updateCollaborateRo,
          }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceUniqueCollaboratorList(spaceId),
      });
    },
  });

  const { mutate: addCollaborators, isPending: addCollaboratorsLoading } = useMutation({
    mutationFn: async ({
      role,
      collaborators,
    }: {
      role: IRole;
      collaborators: IAddCollaborator[];
    }) => {
      const userCollaborators = collaborators.filter((c) => c.principalType === PrincipalType.User);
      const departmentCollaborators = collaborators.filter(
        (c) => c.principalType === PrincipalType.Department
      );
      if (userCollaborators.length > 0) {
        await addSpaceCollaborator(spaceId, {
          collaborators: userCollaborators,
          role: role as IBaseRole,
        });
      }
      if (departmentCollaborators.length > 0) {
        await addSpaceCollaborator(spaceId, {
          collaborators: departmentCollaborators,
          role: role as IBaseRole,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ReactQueryKeys.spaceCollaboratorList(spaceId) });
      queryClient.invalidateQueries({
        queryKey: ReactQueryKeys.spaceUniqueCollaboratorList(spaceId),
      });
      onClose();
      toast.success(t('invite.sendInvitationSuccess'));
    },
  });

  const defaultRole = userRole === Role.Owner ? Role.Creator : userRole;
  const changeTabType = (nextTabType: typeof tabType) => {
    setTabType(nextTabType);
    onSubPageChange(Boolean(nextTabType && nextTabType !== 'collaborators'));
  };
  const onBack = () => changeTabType(undefined);
  const filteredRoleStatic = useFilteredRoleStatic(userRole);
  const baseFilteredRoleStatic = useFilteredBaseRoleStatic(defaultRole);

  if (tabType === 'organization') {
    return (
      <OrgContent
        defaultRole={defaultRole}
        isCreateLoading={addCollaboratorsLoading}
        onCreate={async (role, members) => {
          const userCount = members.filter((m) => m.principalType === PrincipalType.User).length;
          if (await confirmSeat({ role: role as IRole, count: userCount, action: 'invite' })) {
            addCollaborators({ role: role as IRole, collaborators: members });
          }
        }}
        onBack={onBack}
        filteredRoleStatic={filteredRoleStatic}
      />
    );
  }

  const getPermissions = (item: CollaboratorItem) => {
    const canManage = canManageRole(userRole, item.role);
    const isMe = item.type === PrincipalType.User && item.userId === user.id;
    const isOwner = userRole === Role.Owner;
    const canOperator = canManage || isMe || isOwner;
    return {
      canUpdateRole: canOperator,
      canDelete: canOperator,
      showDelete: canOperator,
    };
  };

  const getFilteredRoleStatic = (item: CollaboratorItem) => {
    return item.resourceType === CollaboratorType.Base
      ? baseFilteredRoleStatic
      : filteredRoleStatic;
  };

  return (
    <div className="flex flex-col gap-4">
      <ShareHeader
        title={t('invite.dialog.title', { spaceName })}
        description={
          <Trans
            ns="common"
            i18nKey={'invite.dialog.desc'}
            count={total}
            components={{ b: <b /> }}
          />
        }
      />
      <div className="flex flex-col gap-5">
        {user?.organization && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">{t('invite.addOrgCollaborator.title')}</p>
            <InviteOrgButton onClick={() => changeTabType('organization')} />
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-semibold">{t('invite.dialog.spaceTitle')}</p>
          <CollaboratorsDialog
            title={t('invite.dialog.spaceTitleWithCount', { count: total })}
            content={
              <div className="flex flex-1 flex-col gap-2 overflow-hidden">
                <DebounceInput
                  value={search}
                  onChange={(value) => setSearch(value)}
                  placeholder={t('invite.dialog.collaboratorSearchPlaceholder')}
                />
                <CollaboratorTable
                  groupByPrincipal
                  uniqueList={collaborators}
                  spaceId={spaceId}
                  total={total}
                  hasNextPage={hasNextPage}
                  fetchNextPage={fetchNextPage}
                  isLoading={isListLoading}
                  updateRoleLoading={updateCollaboratorLoading}
                  deleteLoading={deleteCollaboratorLoading || deletePrincipalLoading}
                  getFilteredRoleStatic={getFilteredRoleStatic}
                  onUpdateRole={async (role, item) => {
                    const addedSeats = item.type === PrincipalType.User && !item.billable ? 1 : 0;
                    if (!(await confirmSeat({ role, count: addedSeats, action: 'roleChange' }))) {
                      return;
                    }
                    updateCollaborator({
                      resourceId: item.base?.id || spaceId,
                      isBase: item.resourceType === CollaboratorType.Base,
                      updateCollaborateRo: {
                        principalId:
                          item.type === PrincipalType.User ? item.userId : item.departmentId,
                        principalType: item.type,
                        role,
                      },
                    });
                  }}
                  onDelete={(item) => {
                    deleteCollaborator({
                      resourceId: item.base?.id || spaceId,
                      isBase: item.resourceType === CollaboratorType.Base,
                      principalId:
                        item.type === PrincipalType.User ? item.userId : item.departmentId,
                      principalType: item.type,
                    });
                  }}
                  getPermissions={getPermissions}
                  onDeletePrincipal={(item) => {
                    deletePrincipalBaseGrants({
                      principalId:
                        item.type === PrincipalType.User ? item.userId : item.departmentId,
                      principalType: item.type,
                    });
                  }}
                />
              </div>
            }
          >
            <CollaboratorButton
              className="box-content -translate-x-2 px-2 py-0"
              collaborators={previewCollaborators}
              total={total}
              onClick={() => changeTabType('collaborators')}
            />
          </CollaboratorsDialog>
        </div>
      </div>
    </div>
  );
};
