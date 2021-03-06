import React, { useContext, useEffect, useState, useCallback } from "react";
import DataList from '../../../../../components/DataList';
import { AuthContext } from "../../../../../components/FirebaseAuth";
import { BreadcrumbContext } from '../../../../../components/Breadcrumb';
import { useHistory } from "react-router-dom";
import { HackathonApi, DeleteImageApi } from './HackathonApis';
import { listResponse } from './images.json';
import { Stack, Button } from '@mui/material';
import DataDelete from "../../../../../components/DataDelete";

const ActionButtons = ({id, handleDeletion}) => {
    const history = useHistory();
    const { userData } = useContext(AuthContext);
    const url = '/account/'+userData.currentAccount.id+'/hack2022/edit/'+id;

    return (
        <Stack direction="row" spacing={1} mt={2}>
            <Button variant="contained" onClick={() => history.push(url)}>Edit</Button>
            <DataDelete id={id} handleDeletion={handleDeletion} />
        </Stack>
    )
}

const HackathonList = () => {
    const title = "Hackathon Applications";
    const { userData } = useContext(AuthContext);
    const { setBreadcrumb } = useContext(BreadcrumbContext);
    const history = useHistory();
    const [refreshCount, setRefreshCount] = useState(0);

    const handleFetch = useCallback((page, pageSize) => {
        return new Promise((resolve, reject) => {
            // apply custom filter here if you wish to pass additional parameters to the api calls
            HackathonApi(page, pageSize).then(images => {
                const handleDeletion = (id) => {
                    DeleteImageApi(id).then(() => {
                        setRefreshCount(refreshCount+1);
                    });
                }

                let records = [];
                // loop through the data to add the visual components in to the list
                for(let i=0; i<images.data.length; i++){
                    const record = {
                        id: images.data[i].id,
                        url: images.data[i].url,
                        title: images.data[i].title,
                        homeURL: images.data[i].homeURL,
                        image: <img alt={images.data[i].title} src={images.data[i].url} width={200} />,
                        action: <ActionButtons id={images.data[i].id} handleDeletion={handleDeletion} />
                    }
                    records.push(record);
                }
                resolve({
                    total: images.total,
                    data: records
                });
            }).catch(err => {
                reject(err);
            });
        });
    },[refreshCount]);

    useEffect(() => {
        setBreadcrumb([
            {
                to: "/",
                text: "Home",
                active: false
            },
            {
                to: "/account/"+userData.currentAccount.id+"/",
                text: userData.currentAccount.name,
                active: false
            },
            {
                to: null,
                text: title,
                active: false
            }
        ]);
    },[setBreadcrumb, title, userData]);

    return (
        <Stack spacing={3}>
            {/* <Alert severity="info">
                This is a demo
            </Alert> */}
            <div style={{marginRight: "auto"}}>
                <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={() => history.push("/account/"+userData.currentAccount.id+"/hack2022/create")} >Apply For Event</Button>
                </Stack>
            </div>
            <DataList handleFetch={handleFetch} schema={listResponse} />
        </Stack>
    )
}

export default HackathonList;
